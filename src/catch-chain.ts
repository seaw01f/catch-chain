import type { AsyncReasonMapper, ErrorEffect, ReasonMapper } from './catch-chain.types.js'
import { type CatchHandler, toCatchHandler } from './catch-handler.js'
import type { ErrorMatcher } from './error-matcher.types.js'

const isReasonMapper = <R, V>(value: V | ReasonMapper<R, V> | AsyncReasonMapper<R, V>): value is ReasonMapper<R, V> | AsyncReasonMapper<R, V> =>
  typeof value === 'function'

class CatchChain<R extends Error> {
  private constructor(
    private readonly matcher: ErrorMatcher<R>,
    private readonly effects: readonly ErrorEffect<R>[],
  ) {}

  public static onError<E extends Error>(matcher: ErrorMatcher<E>): CatchChain<E> {
    return new CatchChain(matcher, [])
  }

  public do(effect: ErrorEffect<R>): CatchChain<R> {
    return new CatchChain(this.matcher, [...this.effects, effect])
  }

  private sink<V>(produce: (reason: R) => Promise<V>): CatchHandler<V> {
    const run = async (reason: unknown): Promise<V> => {
      // Only ever called once the matcher has accepted the reason, either by the handler itself or by firstErr.
      const matchedReason = reason as R
      for (const effect of this.effects) {
        await effect(matchedReason)
      }
      return produce(matchedReason)
    }
    return toCatchHandler(this.matcher, run)
  }

  public return<V>(value: V | ReasonMapper<R, V> | AsyncReasonMapper<R, V>): CatchHandler<V> {
    return this.sink(async (reason: R): Promise<V> => isReasonMapper(value) ? await value(reason) : value)
  }

  public throw<E>(error?: E | ReasonMapper<R, E> | AsyncReasonMapper<R, E>): CatchHandler<never> {
    return this.sink(async (reason: R): Promise<never> => {
      if (error === undefined) throw reason
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- callers may currently replace the error with a non-Error value
      throw isReasonMapper(error) ? await error(reason) : error
    })
  }
}

/**
 * Create a catch chain that activates when `matcher` narrows the rejection reason.
 *
 * @example
 * ```ts
 * // Match a specific error type
 * .catch(onErr(isNotFound).return(null))
 *
 * // Side effect, then re-throw
 * .catch(onErr(isTimeout).do(logWarning).throw())
 *
 * // Derive a recovery value from the error
 * .catch(onErr(isNotFound).return(err => defaultItemFor(err.resourceId)))
 *
 * // Replace the error
 * .catch(onErr(isDatabaseError).throw(err => new AppError(`DB failed: ${err.code}`)))
 *
 * // Log and re-throw
 * .catch(onErr(isError).do(err => logger.error(err)).throw())
 * ```
 */
export const onErr = <E extends Error>(matcher: ErrorMatcher<E>) => CatchChain.onError(matcher)
