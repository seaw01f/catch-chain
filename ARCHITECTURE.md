# Architecture

How catch-chain is put together: what a chain is, what a handler is, and how `firstErr` combines handlers. The names below are the ones used in `src/`.

## Vocabulary

- **Matcher** (`ErrorMatcher`): a type guard that decides whether a rejection reason applies. It answers yes or no and has no side effects.
- **Effect** (`ErrorEffect`): a side effect added with `.do()`. It does not change the outcome unless it throws.
- **Outcome**: what the promise settles with once a reason is caught: a recovery value (`.return()`) or a rejection (`.throw()`).
- **Mapper** (`ReasonMapper`, `AsyncReasonMapper`): a function passed to `.return()` or `.throw()` instead of a constant. The terminal operation calls it with the caught reason to derive the outcome: the recovery value or the replacement error. It may be sync or async.
- **Intermediate operation**: an operation that returns another `CatchChain`. Today that is `.do()`.
- **Terminal operation**: an operation that closes the chain and returns a `CatchHandler`: `.return()` and `.throw()`. Both go through the private `CatchChain.sink`.
- **`CatchChain`**: the immutable builder `onErr()` returns. It holds one matcher and a list of effects, and it is not callable.
- **`Chain`**: a closed catch chain, `{ catches, sink }`. `catches` is the chain's matcher; `sink` runs the chain's intermediate operations, then its terminal operation, and is only called once `catches` has accepted the reason.
- **`CatchHandler`**: the callable passed to `.catch()`. Every handler is a list of chains, and the first chain that catches the reason wins. A **single handler** comes from a terminal operation and is a handler with one chain; a **combined handler** comes from `firstErr` and has the chains of every handler it combines.
- **`catches(reason)`**: the public guard. It reports whether any of the handler's chains catches the reason, evaluating matchers only; no effect runs.
- **`[CHAINS]`**: the internal list of chains a handler chooses between. `firstErr` concatenates the `[CHAINS]` of its handlers once, when it is built, so nested `firstErr` handlers are flattened and each matcher is evaluated at most once per rejection.
- **`handlerOf(chains)`**: the one place a `CatchHandler` is built, by both `CatchChain.sink` and `firstErr`.

`CHAINS` is a module-private symbol in `src/catch-handler.ts`; neither it nor `Chain` is exported from the package.

## A. Build time: a chain is built, then closed into a handler

```
   onErr(isRateLimited)          .do(logWarning)          .throw(new RetryableError())
          │                            │                              │
          ▼                            ▼                              ▼
 ┌──────────────────┐  intermediate ┌──────────────────┐   terminal   ┌──────────────────────────┐
 │    CatchChain    │──────────────▶│    CatchChain    │─────────────▶│      CatchHandler        │
 │ matcher: isRL    │   operation   │ matcher: isRL    │  operation   │      (single handler)    │
 │ effects: []      │   (new chain, │ effects: [log]   │  .return()   │                          │
 └──────────────────┘   immutable)  └──────────────────┘  .throw()    │  (reason) → first chain  │
       builder                         builder              │         │  .catches → any chain    │
                                                            │         │  [CHAINS] → one chain    │
                                                            │         └──────────────────────────┘
                                                   CatchChain.sink()     callable, pass to .catch()
                                                   handlerOf()
```

## B. Call time: the first chain that catches the reason wins

```
  firstErr( hNotFound , firstErr(hRateLimited, hTimeout) , hAny )
                 │                     │                     │
                 └──────── concatenate [CHAINS] once ────────┘
                                       │
                                       ▼
         [CHAINS]: [ cNotFound, cRateLimited, cTimeout, cAny ]     (a single handler has one chain)


                       handler(reason)      ◀── the call .catch() makes
                             │
                             ▼
              ┌──────────────────────────────────┐
              │ firstCatching(reason):           │   ◀── matchers only, sync, no effects,
              │   first chain whose catches(r)   │       each evaluated at most once
              └──────────────────────────────────┘
                   │ found               │ none
                   ▼                     ▼
       ┌───────────────────────┐   re-throw reason unchanged
       │ chain.sink(reason)    │   (passes through to the caller)
       │                       │
       │  effect1(reason)      │   ◀── intermediate operations (.do), in order, awaited
       │  effect2(reason)      │
       │       │               │
       │       ▼               │
       │  produce(reason)      │   ◀── terminal operation (.return / .throw)
       └───────────────────────┘
                  │
                  ▼
              OUTCOME
     .return(v) → resolves with v
     .throw(e)  → rejects with e
     .throw()   → rejects with reason

     handler.catches(reason) → whether firstCatching(reason) found a chain; no sink runs

        reason = RateLimitedError
          cNotFound.catches     → no
          cRateLimited.catches  → YES ─▶ cRateLimited.sink ─▶ OUTCOME
          cTimeout, cAny        → never consulted
```

## Why it is shaped this way

- **One `.catch()`, not several.** Chained `.catch()` calls hand a replacement error to the next handler, so a `RetryableError` thrown by one handler is caught again by a catch-all after it. `firstErr` evaluates every matcher against the original rejection and runs only the first chain that catches it.
- **Guard and body are separate.** A chain's `catches` and `sink` are split so a handler can decide which chain applies and then run it without evaluating that chain's matcher a second time.
- **One shape for every handler.** A single handler is a handler with one chain, so `handlerOf` is the only code that searches chains, and single and combined handlers cannot drift apart.
- **Flatten at build time.** Every handler exposes its chains through `[CHAINS]`, so the outer `firstErr` searches one flat list instead of delegating to inner combined handlers, which would evaluate their matchers twice.
- **Everything is immutable.** `.do()` returns a new `CatchChain`, and handlers carry no mutable state, so a handler can be defined once and reused across promises.
