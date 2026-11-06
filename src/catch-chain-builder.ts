import type { AsyncReasonMapper, ErrorEffect, ReasonMapper } from './catch-chain-builder.types.js'
import { type CatchHandler, catchHandlerOf } from './catch-handler.js'
import type { ErrorMatcher } from './error-matcher.types.js'

const isReasonMapper = <E, V>(value: V | ReasonMapper<E, V> | AsyncReasonMapper<E, V>): value is ReasonMapper<E, V> | AsyncReasonMapper<E, V> =>
  typeof value === 'function'

class CatchChainBuilder<E extends Error> {
  private constructor(
    private readonly matcher: ErrorMatcher<E>,
    private readonly intermediateOperations: readonly ErrorEffect<E>[],
  ) {}

  public static onError<M extends Error>(matcher: ErrorMatcher<M>): CatchChainBuilder<M> {
    return new CatchChainBuilder(matcher, [])
  }

  public do(effect: ErrorEffect<E>): CatchChainBuilder<E> {
    return new CatchChainBuilder(this.matcher, [...this.intermediateOperations, effect])
  }

  private build<V>(terminalOperation: (reason: E) => Promise<V>): CatchHandler<V> {
    const { matcher } = this
    return catchHandlerOf({
      // Called as a plain function so a matcher never sees the internal builder object as `this`.
      catches: (reason: unknown): boolean => matcher(reason),
      sink: async (reason: unknown): Promise<V> => {
        // A chain's sink is only called after its catches - this matcher - has accepted the reason.
        const caughtReason = reason as E
        for (const intermediateOperation of this.intermediateOperations) {
          await intermediateOperation(caughtReason)
        }
        return terminalOperation(caughtReason)
      },
    })
  }

  public return<V>(value: V | ReasonMapper<E, V> | AsyncReasonMapper<E, V>): CatchHandler<V> {
    return this.build(async (reason: E): Promise<V> => isReasonMapper(value) ? await value(reason) : value)
  }

  public throw<T>(error?: T | ReasonMapper<E, T> | AsyncReasonMapper<E, T>): CatchHandler<never> {
    return this.build(async (reason: E): Promise<never> => {
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
export const onErr = <E extends Error>(matcher: ErrorMatcher<E>) => CatchChainBuilder.onError(matcher)
