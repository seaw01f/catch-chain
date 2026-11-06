import type { AsyncReasonMapper, ErrorEffect, ReasonMapper } from './catch-chain.types.js'
import type { ErrorMatcher } from './error-matcher.types.js'

const RUN: unique symbol = Symbol('catch-chain.run')
const BRANCHES: unique symbol = Symbol('catch-chain.branches')

/**
 * A rejection handler to pass to `.catch()`, produced by `.return()`, `.throw()` or {@link firstErr}.
 *
 * Calling it with a reason its matcher accepts runs the effects and resolves or rejects with the produced outcome.
 * Any other reason is re-thrown unchanged.
 */
export type CatchHandler<V> = {
  /**
   * The call signature `.catch()` invokes. If `catches(reason)` holds, the effects run and the promise settles with the
   * produced outcome: the recovery value for `.return()`, a rejection for `.throw()`. Otherwise it rejects with `reason`
   * unchanged, so the rejection passes through to the caller. The parameter is `unknown` because a promise can reject
   * with anything - the matcher is what narrows it.
   */
  (reason: unknown): Promise<V>

  /**
   * Whether this handler would catch `reason` when passed to `.catch()`, whether it then recovers or re-throws.
   * Evaluates the matcher only - no effect runs.
   */
  readonly catches: (reason: unknown) => boolean

  /**
   * Runs the effects and produces the outcome without consulting the matcher, so a caller that has already
   * established `catches(reason)` - {@link firstErr} - does not evaluate it a second time. Only ever called after
   * `catches` has accepted the reason. Internal: the symbol is not exported, so only this module can call it.
   */
  readonly [RUN]: (reason: unknown) => Promise<V>

  /**
   * The single-matcher handlers a {@link firstErr} handler was combined from, flattened through nesting so that each
   * matcher is evaluated at most once per rejection. Absent on a handler built by `.return()` or `.throw()`.
   */
  readonly [BRANCHES]?: readonly CatchHandler<V>[] | undefined
}

type HandlerValue<H> = H extends CatchHandler<infer V> ? V : never

const isReasonMapper = <R, V>(value: V | ReasonMapper<R, V> | AsyncReasonMapper<R, V>): value is ReasonMapper<R, V> | AsyncReasonMapper<R, V> =>
  typeof value === 'function'

const toCatchHandler = <V>(catches: (reason: unknown) => boolean, run: (reason: unknown) => Promise<V>): CatchHandler<V> => {
  const handler = async (reason: unknown): Promise<V> => {
    if (catches(reason)) {
      return run(reason)
    }
    throw reason
  }
  return Object.assign(handler, { catches, [RUN]: run })
}

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

/**
 * Combine handlers so that the first one whose matcher accepts the rejection handles it, and no other handler sees it.
 *
 * Chained `.catch()` calls hand a replacement error to the next handler; `firstErr` evaluates every matcher against
 * the original rejection and runs only the first match. A rejection no handler matches is re-thrown unchanged.
 *
 * @example
 * ```ts
 * await fetchUser(id).catch(firstErr(
 *   onErr(isNotFound).return(null),
 *   onErr(isRateLimited).do(logWarning).throw(new RetryableError()),
 *   onErr(isError).do(reportToSentry).throw(err => new AppError(`Unexpected: ${err.message}`)),
 * ))
 * ```
 */
export const firstErr = <H extends readonly [CatchHandler<unknown>, ...CatchHandler<unknown>[]]>(...handlers: H): CatchHandler<HandlerValue<H[number]>> => {
  // Every handler resolves with its own value type, so each branch resolves with a member of the union.
  const branches = handlers.flatMap(handler => handler[BRANCHES] ?? [handler]) as readonly CatchHandler<HandlerValue<H[number]>>[]
  const catches = (reason: unknown): boolean => branches.some(branch => branch.catches(reason))
  const runFirstCatcher = async (reason: unknown): Promise<HandlerValue<H[number]>> => {
    const firstCatcher = branches.find(branch => branch.catches(reason))
    if (firstCatcher !== undefined) {
      return firstCatcher[RUN](reason)
    }
    throw reason
  }
  return Object.assign(runFirstCatcher, { catches, [RUN]: runFirstCatcher, [BRANCHES]: branches })
}
