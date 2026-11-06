# Architecture

How catch-chain is put together: what a chain is, what a handler is, and how `firstErr` combines handlers. The names below are the ones used in `src/`.

## Vocabulary

- **Matcher** (`ErrorMatcher`): a type guard that decides whether a rejection reason applies. It answers yes or no and has no side effects.
- **Effect** (`ErrorEffect`): a side effect added with `.do()`. It does not change the outcome unless it throws.
- **Outcome**: what the promise settles with once a reason is caught: a recovery value (`.return()`) or a rejection (`.throw()`).
- **Mapper** (`ReasonMapper`, `AsyncReasonMapper`): a function passed to `.return()` or `.throw()` instead of a constant. The terminal operation calls it with the caught reason to derive the outcome: the recovery value or the replacement error. It may be sync or async.
- **Intermediate operation**: an operation that returns another `CatchChainBuilder`. Today that is `.do()`.
- **Terminal operation**: an operation that closes the chain and returns a `CatchHandler`: `.return()` and `.throw()`. Both go through the private `CatchChainBuilder.build`.
- **`CatchChainBuilder`**: the immutable builder `onErr()` returns. It holds one matcher and a list of effects, and it is not callable.
- **`CatchChain`**: a built catch chain, `{ matcher, intermediateOperations, terminalOperation }`, produced by a terminal operation. It is plain data; `catchHandlerOf` is what runs it. Its operations take `unknown` so chains for different error types share one list, and the handler only passes them a reason the chain's matcher has accepted.
- **`CatchHandler`**: the callable passed to `.catch()`. Every handler is a list of chains, and the first chain that catches the reason wins. A **single handler** comes from a terminal operation and is a handler with one chain; a **combined handler** comes from `firstErr` and has the chains of every handler it combines.
- **`catches(reason)`**: the public guard. It reports whether any of the handler's chains catches the reason, evaluating matchers only; no effect runs.
- **`[CHAINS]`**: the internal list of chains a handler chooses between. `firstErr` concatenates the `[CHAINS]` of its handlers once, when it is built, so nested `firstErr` handlers are flattened and each matcher is evaluated at most once per rejection.
- **`catchHandlerOf(chains)`**: builds a `CatchHandler` from chains and is the one place chains are run. Both `CatchChainBuilder.build` and `firstErr` use it.

`CHAINS` is a module-private symbol in `src/catch-handler.ts`; neither it nor `CatchChain` is exported from the package.

## A. Build time: a builder produces a chain, wrapped in a handler

```
    onErr(isRateLimited)                        .do(logWarning)                   .throw(new RetryableError())
              │                                        │                                        │
              ▼                                        ▼                                        ▼
 ┌────────────────────────┐  intermediate ┌────────────────────────┐   terminal   ┌──────────────────────────┐
 │ CatchChainBuilder      │──────────────▶│ CatchChainBuilder      │─────────────▶│       CatchHandler       │
 │ matcher: isRateLimited │   operation   │ matcher: isRateLimited │  operation   │     (single handler)     │
 │ effects: []            │ (new builder, │ effects: [logWarning]  │  .return()   │                          │
 └────────────────────────┘   immutable)  └────────────────────────┘  .throw()    │  (reason) → first chain  │
           builder                                  builder           │           │  .catches → any chain    │
                                                                      │           │  [CHAINS] → one chain    │
                                                                      │           └──────────────────────────┘
                                                                      │                         ▲
                                                                      ▼                         │ catchHandlerOf()
                                                                   build() ──▶ CatchChain ──────┘
                                                                     { matcher, intermediateOperations, terminalOperation }
```

## B. Call time: the first chain that catches the reason wins

```
  firstErr( notFoundHandler , firstErr(rateLimitedHandler, timeoutHandler) , anyHandler )
                   │                            │                              │
                   └────────────── concatenate [CHAINS] once ──────────────────┘
                                                │
                                                ▼
       [CHAINS]: [ notFoundChain, rateLimitedChain, timeoutChain, anyChain ]     (a single handler has one chain)


                       handler(reason)      ◀── the call .catch() makes
                             │
                             ▼
              ┌───────────────────────────────────┐
              │ firstCatching(reason):            │   ◀── matchers only, sync, no effects,
              │   first chain whose               │       each evaluated at most once
              │   matcher(reason) holds           │
              └───────────────────────────────────┘
                   │ found               │ none
                   ▼                     ▼
       ┌───────────────────────┐   re-throw reason unchanged
       │ run the chain         │   (passes through to the caller)
       │                       │
       │  effect1(reason)      │   ◀── intermediateOperations (.do), in order, awaited
       │  effect2(reason)      │
       │       │               │
       │       ▼               │
       │  produce(reason)      │   ◀── terminalOperation (.return / .throw)
       └───────────────────────┘
                  │
                  ▼
              OUTCOME
     .return(value) → resolves with value
     .throw(error)  → rejects with error
     .throw()       → rejects with reason

     handler.catches(reason) → whether firstCatching(reason) found a chain; no operation runs

        reason = RateLimitedError
          notFoundChain.matcher     → no
          rateLimitedChain.matcher  → YES ─▶ run rateLimitedChain ─▶ OUTCOME
          timeoutChain, anyChain    → never consulted
```

## Why it is shaped this way

- **One `.catch()`, not several.** Chained `.catch()` calls hand a replacement error to the next handler, so a `RetryableError` thrown by one handler is caught again by a catch-all after it. `firstErr` evaluates every matcher against the original rejection and runs only the first chain that catches it.
- **A chain is data; the handler runs it.** The builder only assembles a chain, and `catchHandlerOf` is the only code that executes one. The matcher is separate from the operations it guards, so a handler can decide which chain applies and then run it without evaluating that chain's matcher a second time.
- **One shape for every handler.** A single handler is a handler with one chain, so `catchHandlerOf` is the only code that searches chains, and single and combined handlers cannot drift apart.
- **Flatten at build time.** Every handler exposes its chains through `[CHAINS]`, so the outer `firstErr` searches one flat list instead of delegating to inner combined handlers, which would evaluate their matchers twice.
- **Everything is immutable.** `.do()` returns a new `CatchChainBuilder`, and handlers carry no mutable state, so a handler can be defined once and reused across promises.
