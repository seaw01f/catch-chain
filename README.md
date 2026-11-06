# catch-chain

[![npm version](https://img.shields.io/npm/v/catch-chain)](https://www.npmjs.com/package/catch-chain)
[![npm downloads](https://img.shields.io/npm/dm/catch-chain)](https://www.npmjs.com/package/catch-chain)
[![bundle size](https://img.shields.io/bundlephobia/minzip/catch-chain)](https://bundlephobia.com/package/catch-chain)
[![license](https://img.shields.io/npm/l/catch-chain)](./LICENSE)
[![CI](https://github.com/seaw01f/catch-chain/actions/workflows/ci.yml/badge.svg)](https://github.com/seaw01f/catch-chain/actions/workflows/ci.yml)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue)
![zero dependencies](https://img.shields.io/badge/dependencies-0-green)

Fluent error matching and recovery for JavaScript promises.

```ts
await fetchUser(id).catch(firstErr(
  onErr(isNotFound).return(null),
  onErr(isRateLimited).do(logWarning).throw(),
  onErr(isError).throw(err => new AppError(`Unexpected: ${err.message}`)),
))
```

No more `catch` blocks with nested `if/else` chains. Define what to match, what to do, and how to recover - in a readable, composable chain.

## Install

```bash
npm install catch-chain
```

## Why

A typical promise `.catch()` quickly turns into this:

```ts
await fetchUser(id).catch(err => {
  if (err instanceof NotFoundError) {
    return null
  }
  if (err instanceof RateLimitError) {
    logWarning(err)
    throw new RetryableError()
  }
  reportToSentry(err)
  throw new AppError('Unexpected failure')
})
```

Every handler mixes matching, side effects, and recovery in one block. As cases grow, readability suffers. catch-chain separates these concerns:

```ts
await fetchUser(id).catch(firstErr(
  onErr(isNotFound).return(null),
  onErr(isRateLimited).do(logWarning).throw(new RetryableError()),
  onErr(isError).do(reportToSentry).throw(err => new AppError(`Unexpected: ${err.message}`)),
))
```

- Each handler handles one case.
- The first handler whose matcher matches handles the error, and no other handler sees it - just like multi-catch in Java or pattern matching in Rust.
- Errors no handler matches pass through unchanged.

## API

### `onErr(matcher)`

Creates a chain that only activates when `matcher` returns `true` for the rejected value.

```ts
import { onErr } from 'catch-chain'

const isNotFound = (reason: unknown): reason is NotFoundError => reason instanceof NotFoundError

await fetchUser(id).catch(onErr(isNotFound).return(null))
```

A matcher is a [type guard](https://www.typescriptlang.org/docs/handbook/2/narrowing.html#using-type-predicates) - it receives `unknown` and narrows to a specific error type. This gives you full type safety in `.do()` and `.return()`/`.throw()` callbacks.

### Matching any error

The examples in this README use an `isError` matcher that matches any `Error` instance. Define it once in your code:

```ts
const isError = (reason: unknown): reason is Error => reason instanceof Error

await riskyOperation().catch(onErr(isError).return('fallback'))
```

Non-`Error` rejections (strings, plain objects, etc.) pass through unhandled.

### `.do(effect)`

**[Pipe operation]** Run a side effect when the error matches. Returns the chain for further chaining. The effect can be sync or async.

```ts
// Sync effect - log and recover
.catch(onErr(isError)
  .do(err => console.error(err))
  .return(defaults))
  
// Async effect
.catch(onErr(isError)
  .do(async err => await alertOncall(err))
  .throw(new ServiceUnavailableError()))

// Multiple effects, executed in order
.catch(onErr(isError)
  .do(err => metrics.increment('errors'))
  .do(logger.error)
  .throw())
```

### `.return(value)`

**[Terminal operation]** Recover from the error by resolving the promise with `value`. If the error doesn't match, it's re-thrown unchanged.

```ts
// Static value
.catch(onErr(isNotFound).return(null))

// Sync mapper - derive a value from the error
.catch(onErr(isNotFound).return(err => defaultItemFor(err.resourceId)))

// Async mapper - derive a value from the error
.catch(onErr(isNotFound).return(async err => await fetchFallback(err.resourceId)))
```

When `value` is a function, it's called with the matched error and its return value is used.

### `.throw(error?)`

**[Terminal operation]** Re-throw the original error, replace it, or map it. If the error doesn't match, the original is re-thrown unchanged.

```ts
// No args - re-throw original (useful after side effects)
.catch(onErr(isDatabaseError)
  .do(err => logger.error(err))
  .throw())

// Constant - replace with a different error
.catch(onErr(isDatabaseError)
  .throw(new AppError('Something went wrong')))

// Sync mapper - transform the error
.catch(onErr(isDatabaseError)
  .throw(err => new AppError(`DB failed: ${err.code}`)))

// Async mapper - transform the error
.catch(onErr(isDatabaseError)
  .throw(async err => new AppError(`DB failed: ${await resolveCode(err)}`)))
```

### `firstErr(...handlers)`

Combine handlers into one. Each matcher is evaluated against the original rejection, in order, and the first handler that matches handles it - its effects run and its `.return()` or `.throw()` decides the outcome. No other handler sees the error, not even the one its `.throw()` produces. If no handler matches, the original error is re-thrown unchanged.

```ts
import { firstErr, onErr } from 'catch-chain'

const user = await fetchUser(id).catch(firstErr(
  onErr(isNotFound).return(null),
  onErr(isTimeout).throw(new RetryableError()),
  onErr(isError).throw(new AppError('Unexpected')),
))
```

The result is itself a handler: it can be passed to another `firstErr`, and the same one can be reused across promises.

```ts
const httpErrors = firstErr(
  onErr(isNotFound).return(null),
  onErr(isConflict).throw(new ConflictError()),
)

await fetchUser(id).catch(firstErr(httpErrors, onErr(isError).throw(new AppError('Unexpected'))))
```

### Reusable handlers

`.return()`, `.throw()` and `firstErr()` all return a `CatchHandler`. Handlers are immutable, so define one once and pass it to as many `.catch()` calls as you like.

```ts
import type { CatchHandler } from 'catch-chain'

const notFoundAsNull: CatchHandler<null> = onErr(isNotFound).return(null)

const user = await fetchUser(id).catch(notFoundAsNull)
const team = await fetchTeam(teamId).catch(notFoundAsNull)
```

`handler.catches(reason)` tells you whether a handler would catch `reason` when passed to `.catch()` - whether it then recovers or re-throws. It evaluates the matchers only - no effects run.

```ts
const retryable = firstErr(onErr(isTimeout).throw(), onErr(isRateLimited).throw())

if (retryable.catches(err)) scheduleRetry(job)
```

### Matchers, intermediate operations (effects) and terminal operations (return/throw) should not throw

Matchers (`onErr()`), effects (`.do()`) and value/error producers (`.return()` / `.throw()` callbacks) are expected to not throw or reject.
**The library does not catch errors from these functions - if one throws, the thrown error replaces the original and propagates to the caller.**
A matcher that throws also makes `handler.catches(reason)` throw, so keep matchers to checks that cannot fail on unexpected input.

## Patterns

### Multi-catch

Chaining `.catch()` calls does not give you multi-catch. Each `.catch()` sees whatever the previous one threw, so a replacement error from one handler is handed to the next. Here the `RetryableError` is caught again by `isError` and turned into an `AppError`:

```ts
// Wrong: the RetryableError never reaches the caller
const user = await fetchUser(id)
  .catch(onErr(isTimeout).throw(new RetryableError()))
  .catch(onErr(isError).throw(new AppError('Unexpected')))
```

Use `firstErr` instead - the first matching handler handles the error and no other handler sees it.

```ts
const user = await fetchUser(id).catch(firstErr(
  onErr(isNotFound).return(null),
  onErr(isTimeout).throw(new RetryableError()),
  onErr(isError).throw(new AppError('Unexpected')),
))
```

### Log and re-throw

Use `.do()` for side effects, then `.throw()` to re-throw (same or different error).

```ts
await processPayment(order)
  .catch(onErr(isError)
    .do(err => logger.error('Payment failed', { orderId: order.id, err }))
    .throw(err => new PaymentError(err.message)))
```

### Graceful degradation

Return a default value when a non-critical operation fails.

```ts
const preferences = await loadPreferences(userId)
  .catch(onErr(isError).return(DEFAULT_PREFERENCES))
```

### Custom matchers

A matcher is any function with the signature `(reason: unknown) => reason is E`. Build matchers that check properties, codes, or any condition.

```ts
const isConflict = (reason: unknown): reason is HttpError =>
  reason instanceof HttpError && reason.status === 409

await saveDocument(doc)
  .catch(onErr(isConflict).return(() => mergeAndRetry(doc)))
```

### Effect-only handling

Use `.do()` with `.throw()` when you want to observe the error without changing the outcome.

```ts
await backgroundSync()
  .catch(onErr(isError)
    .do(err => telemetry.record('sync_failed', err))
    .throw())
```

## Types

All types are inferred automatically. You don't need to import anything beyond `onErr` and `firstErr`.

`CatchHandler<V>` is exported for annotating reusable handlers. `V` is the value the handler resolves with when it recovers - `null` for `.return(null)`, `never` for `.throw()`. A `firstErr` handler resolves with the union of its handlers' values.

A matcher is a type guard with this shape, where `E` must extend `Error`:

```ts
(reason: unknown) => reason is E
```

The `.do()`, `.return()`, and `.throw()` callbacks receive the narrowed type from your matcher - no manual annotations needed.

## Design

- **Match or pass through** - unmatched errors propagate unchanged, and `firstErr` lets exactly one handler handle each error
- **Type-safe** - matchers are type guards, so `.do()`, `.return()`, and `.throw()` callbacks receive the narrowed error type
- **Zero dependencies** - only uses native `Error`, `Promise`, and `instanceof`
- **Tiny** - under 1.5 KB minified and gzipped, ships ESM + CJS with full TypeScript declarations

## Changelog

See [GitHub Releases](https://github.com/seaw01f/catch-chain/releases).

## License

[MIT](./LICENSE)
