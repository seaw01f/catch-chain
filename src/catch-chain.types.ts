/**
 * Side effect executed when an error matches.
 * Receives the matched error.
 * May be sync or async.
 *
 * **Should not throw!!! If it does, the thrown error replaces the original!**
 */
export type ErrorEffect<E> = (reason: E) => unknown

/**
 * Sync function that maps a matched error to a recovery value or replacement error.
 *
 * **Should not throw!!! If it does, the thrown error replaces the intended outcome!**
 */
export type ReasonMapper<E, V> = (reason: E) => V

/**
 * Async function that maps a matched error to a recovery value or replacement error.
 *
 * **Should not reject!!! If it does, the rejection replaces the intended outcome!**
 */
export type AsyncReasonMapper<E, V> = (reason: E) => PromiseLike<V>
