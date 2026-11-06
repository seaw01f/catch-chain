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
await fetchUser(id)
  .catch(onErr(isNotFound).return(null))
  .catch(onErr(isRateLimited).do(logWarning).throw())
  .catch(onErr(isError).throw(err => new AppError(`Unexpected: ${err.message}`)))
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
await fetchUser(id)
  .catch(onErr(isNotFound).return(null))
  .catch(onErr(isRateLimited).do(logWarning).throw(new RetryableError()))
  .catch(onErr(isError).do(reportToSentry).throw(err => new AppError(`Unexpected: ${err.message}`)))
```

- Each `.catch()` handles one case.
- Unmatched errors pass through to the next handler - just like multi-catch in Java or pattern matching in Rust.

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

### Effects and producers should not throw

Effects (`.do()`) and value/error producers (`.return()` / `.throw()` callbacks) are expected to not throw or reject.
The library does not catch errors from these functions - if one throws, the thrown error replaces the original and propagates to the caller.

## Patterns

### Multi-catch

Chain multiple `.catch()` calls - each handles one error type. Unmatched errors fall through.

```ts
const user = await fetchUser(id)
  .catch(onErr(isNotFound).return(null))
  .catch(onErr(isTimeout).throw(new RetryableError()))
  .catch(onErr(isError).throw(new AppError('Unexpected')))
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

All types are inferred automatically. You don't need to import anything beyond `onErr`.

A matcher is a type guard with this shape, where `E` must extend `Error`:

```ts
(reason: unknown) => reason is E
```

The `.do()`, `.return()`, and `.throw()` callbacks receive the narrowed type from your matcher - no manual annotations needed.

## Design

- **Match or pass through** - unmatched errors propagate unchanged, enabling composable multi-catch chains
- **Type-safe** - matchers are type guards, so `.do()`, `.return()`, and `.throw()` callbacks receive the narrowed error type
- **Zero dependencies** - only uses native `Error`, `Promise`, and `instanceof`
- **Tiny** - under 1.5 KB, ships ESM + CJS with full TypeScript declarations

## Changelog

See [GitHub Releases](https://github.com/seaw01f/catch-chain/releases).

## License

[MIT](./LICENSE)
