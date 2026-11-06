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
- **`CatchHandler`**: the callable passed to `.catch()`. A **single handler** comes from a terminal operation and has one matcher; a **combined handler** comes from `firstErr` and chooses between several chains.
- **`catches(reason)`**: the public guard. It evaluates the matcher only; no effect runs.
- **`[SINK_CHAIN](reason)`**: the internal, unguarded path. It invokes the chain's intermediate and terminal operations without consulting the matcher, and is only called once `catches` has accepted the reason.
- **`[FLAT_CHAINS]`**: the internal, flattened list of catch chains a combined handler chooses between. Nested `firstErr` handlers are flattened into it once, when the handler is built, so each matcher is evaluated at most once per rejection.

`SINK_CHAIN` and `FLAT_CHAINS` are module-private symbols in `src/catch-handler.ts` and are not exported from the package.

## A. Build time: a chain is built, then closed into a handler

```
   onErr(isRateLimited)          .do(logWarning)          .throw(new RetryableError())
          │                            │                              │
          ▼                            ▼                              ▼
 ┌──────────────────┐  intermediate ┌──────────────────┐   terminal   ┌──────────────────────────┐
 │    CatchChain    │──────────────▶│    CatchChain    │─────────────▶│      CatchHandler        │
 │ matcher: isRL    │   operation   │ matcher: isRL    │  operation   │      (single handler)    │
 │ effects: []      │   (new chain, │ effects: [log]   │  .return()   │                          │
 └──────────────────┘   immutable)  └──────────────────┘  .throw()    │  (reason)     → guarded  │
       builder                         builder              │         │  .catches     → matcher  │
                                                            │         │  [SINK_CHAIN] → unguarded│
                                                            │         └──────────────────────────┘
                                                   CatchChain.sink()     callable, pass to .catch()
                                                   guardedHandler()
                                                   asCatchHandler()
```

## B. Call time: what a single handler does with a rejection

```
                       handler(reason)      ◀── the call .catch() makes
                             │
                             ▼
                  ┌─────────────────────┐
                  │   catches(reason)?  │   ◀── matcher only, sync, no effects
                  │     (the guard)     │
                  └─────────────────────┘
                     │ yes          │ no
                     ▼              ▼
       ┌───────────────────────┐   re-throw reason unchanged
       │ [SINK_CHAIN](reason)  │   (passes through to the caller)
       │ (unguarded)           │
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
```

## C. Combining: `firstErr` picks one chain

```
  firstErr( hNotFound , firstErr(hRateLimited, hTimeout) , hAny )
                 │                     │                     │
                 └──────── flatten [FLAT_CHAINS] once ───────┘
                                       │
                                       ▼
                flatChains: [ hNotFound, hRateLimited, hTimeout, hAny ]
                                       │
                                       ▼
                ┌───────────────────────────────────────────────────┐
                │        CatchHandler  (combined handler)           │
                │                                                   │
                │  handler(reason):                                 │
                │    first = flatChains.find(c => c.catches(r))     │
                │    first ? first[SINK_CHAIN](r) : re-throw r      │
                │                                                   │
                │  .catches      → any chain catches                │
                │  [SINK_CHAIN]  → same as handler(reason)          │
                │  [FLAT_CHAINS] → the flat list (for nesting)      │
                └───────────────────────────────────────────────────┘

        reason = RateLimitedError
          hNotFound.catches     → no
          hRateLimited.catches  → YES ─▶ hRateLimited[SINK_CHAIN] ─▶ OUTCOME
          hTimeout, hAny        → never consulted
```

## Why it is shaped this way

- **One `.catch()`, not several.** Chained `.catch()` calls hand a replacement error to the next handler, so a `RetryableError` thrown by one handler is caught again by a catch-all after it. `firstErr` evaluates every matcher against the original rejection and runs only the first chain that catches it.
- **Guard and body are separate.** `catches` and `[SINK_CHAIN]` are split so `firstErr` can decide which chain applies and then run it without evaluating that chain's matcher a second time.
- **Flatten at build time.** A nested `firstErr` exposes its chains through `[FLAT_CHAINS]`, so the outer `firstErr` searches one flat list instead of delegating to inner combined handlers, which would evaluate their matchers twice.
- **Everything is immutable.** `.do()` returns a new `CatchChain`, and handlers carry no mutable state, so a handler can be defined once and reused across promises.
