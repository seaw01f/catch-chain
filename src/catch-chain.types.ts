/**
 * @internal Async predicate that tests whether an error matches the chain's accumulated conditions.
 */
export type TestPredicate<V> = (value: V) => PromiseLike<boolean>

/**
 * @internal Async function that produces the final value for a return or throw sink.
 */
export type SinkValueProducer<R, V> = (reason: R) => Promise<V>

/**
 * Side effect executed when an error matches.
 * Receives the matched error.
 * May be sync or async.
 *
 * **Should not throw!!! If it does, the thrown error replaces the original!**
 */
export type ErrorEffect<R> = (value: R) => unknown

/**
 * Sync function that maps a matched error to a recovery value or replacement error.
 *
 * **Should not throw!!! If it does, the thrown error replaces the intended outcome!**
 */
export type ReasonMapper<R, V> = (reason: R) => V

/**
 * Async function that maps a matched error to a recovery value or replacement error.
 *
 * **Should not reject!!! If it does, the rejection replaces the intended outcome!**
 */
export type AsyncReasonMapper<R, V> = (reason: R) => PromiseLike<V>
