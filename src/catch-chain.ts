import type {
  AsyncReasonMapper,
  ErrorEffect,
  ReasonMapper,
  SinkValueProducer,
  TestPredicate,
} from './catch-chain.types.js'
import type { ErrorMatcher } from './error-matcher.types.js'

class CatchChain<R> {
  private readonly test: TestPredicate<R>

  private constructor(test: TestPredicate<R>) {
    this.test = test
  }

  public static onError<E extends Error>(matcher: ErrorMatcher<E>): CatchChain<E> {
    return new CatchChain(async (value: E): Promise<boolean> => matcher(value))
  }

  public do(effect: ErrorEffect<R>): CatchChain<R> {
    return new CatchChain(async (value): Promise<boolean> => {
      const testResult = await this.test(value)
      if (testResult) {
        await effect(value)
      }
      return testResult
    })
  }

  private sink<V>(valueProducer: SinkValueProducer<R, V>): AsyncReasonMapper<R, V> {
    return async (reason: R): Promise<V> => {
      if (await this.test(reason)) {
        return valueProducer(reason)
      }
      throw reason
    }
  }

  public return<V>(value: V | ReasonMapper<R, V> | AsyncReasonMapper<R, V>): AsyncReasonMapper<R, V> {
    const valueProducer: SinkValueProducer<R, V> = async (reason: R): Promise<V> => {
      return value instanceof Function ? await value(reason) : value
    }
    return this.sink(valueProducer)
  }

  public throw<E>(error?: E | ReasonMapper<R, E> | AsyncReasonMapper<R, E>): AsyncReasonMapper<R, never> {
    const valueProducer: SinkValueProducer<R, never> = async (reason: R): Promise<never> => {
      if (error === undefined) throw reason
      throw error instanceof Function ? await error(reason) : error
    }
    return this.sink(valueProducer)
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
