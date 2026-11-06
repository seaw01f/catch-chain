import type { CatchChain } from './catch-chain.js'

const CHAINS: unique symbol = Symbol.for('catch-chain.chains')

/**
 * A rejection handler to pass to `.catch()`, produced by `.return()`, `.throw()` or {@link firstErr}.
 *
 * Calling it with a reason one of its chains catches runs that chain's effects and resolves or rejects with the produced outcome.
 * Any other reason is re-thrown unchanged.
 */
export type CatchHandler<V> = {
  /**
   * The call signature `.catch()` invokes.
   *
   * The first chain whose matcher accepts `reason` runs its effects and the promise settles with the produced outcome:
   * the recovery value for `.return()`, a rejection for `.throw()`.
   * If no chain's matcher accepts the reason, it rejects with `reason` unchanged, so the rejection passes through to the caller.
   *
   * The parameter is `unknown` because a promise can reject with anything - the matcher is what narrows it.
   */
  (reason: unknown): Promise<V>

  /**
   * Whether this handler would catch `reason` when passed to `.catch()`, whether it then recovers or re-throws.
   * Evaluates the matchers only - no effect runs. If a matcher throws, so does `catches`.
   */
  readonly catches: (reason: unknown) => boolean

  /**
   * The chains this handler chooses between, in order.
   *
   * A nested {@link firstErr} handler contributes its chains here when the outer one is built,
   * so the outer handler searches one flat list and each matcher is evaluated at most once per rejection.
   *
   * INTERNAL: the symbol is not exported from the package.
   */
  readonly [CHAINS]: readonly CatchChain<V>[]
}

export type CatchHandlerValue<H> = H extends CatchHandler<infer V> ? V : never

/**
 * Builds the handler that runs the first of `chains` whose matcher accepts a rejection and re-throws it unchanged when none does.
 * Each chain's matcher is evaluated at most once per call.
 */
export const catchHandlerOf = <V>(...chains: readonly CatchChain<V>[]): CatchHandler<V> => {
  // Destructured so a matcher is called as a plain function and never sees the chain as `this`.
  const firstCatchingChain = (reason: unknown): CatchChain<V> | undefined => chains.find(({ matcher }) => matcher(reason))

  const handler = async (reason: unknown): Promise<V> => {
    const chain = firstCatchingChain(reason)

    // No chain can handle the reason/error.
    if (chain === undefined) {
      throw reason
    }

    // The first chain that can handle the reason/error will execute each intermediate operation and finish it of with the terminal operation.
    const { intermediateOperations, terminalOperation } = chain
    for (const intermediateOperation of intermediateOperations) {
      await intermediateOperation(reason)
    }
    return terminalOperation(reason)
  }

  // Frozen so a handler shared across modules cannot be changed by one of them:
  // the handler, its chain list, each chain and each chain's intermediate operations.
  return Object.freeze(Object.assign(handler, {
    catches: (reason: unknown): boolean => firstCatchingChain(reason) !== undefined,
    [CHAINS]: Object.freeze(chains.map(chain => Object.freeze({
      ...chain,
      intermediateOperations: Object.freeze([...chain.intermediateOperations]),
    }))),
  }))
}

/**
 * Combine handlers so that the first one whose matcher accepts the rejection handles it, and no other handler sees it.
 *
 * `firstErr` evaluates every matcher against the original rejection and runs only the first match (in contrast to chained `.catch()` calls that hand a **replacement error** to the next handler).
 * A rejection no handler matches is re-thrown unchanged.
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
export const firstErr = <H extends readonly [CatchHandler<unknown>, ...CatchHandler<unknown>[]]>(...handlers: H): CatchHandler<CatchHandlerValue<H[number]>> =>
  // Every handler resolves with its own value type, so each of its chains resolves with a member of the union.
  catchHandlerOf(...handlers.flatMap(handler => handler[CHAINS]) as readonly CatchChain<CatchHandlerValue<H[number]>>[])
