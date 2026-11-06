const CHAINS: unique symbol = Symbol('catch-chain.chains')

/**
 * One closed catch chain: a matcher together with the operations it guards. A single handler has one chain; a
 * {@link firstErr} handler has the chains of every handler it was combined from.
 */
type Chain<V> = {
  /**
   * The chain's matcher. Decides whether this chain catches `reason`; runs no effect.
   */
  readonly catches: (reason: unknown) => boolean

  /**
   * Runs the chain's intermediate operations - the effects, in order - then its terminal operation, and settles with
   * the outcome. Does not consult the matcher: only ever called after `catches` has accepted the reason.
   */
  readonly sink: (reason: unknown) => Promise<V>
}

/**
 * A rejection handler to pass to `.catch()`, produced by `.return()`, `.throw()` or {@link firstErr}.
 *
 * Calling it with a reason one of its chains catches runs that chain's effects and resolves or rejects with the
 * produced outcome. Any other reason is re-thrown unchanged.
 */
export type CatchHandler<V> = {
  /**
   * The call signature `.catch()` invokes. The first chain whose `catches(reason)` holds runs its effects and the
   * promise settles with the produced outcome: the recovery value for `.return()`, a rejection for `.throw()`. If no
   * chain catches the reason, it rejects with `reason` unchanged, so the rejection passes through to the caller. The
   * parameter is `unknown` because a promise can reject with anything - the matcher is what narrows it.
   */
  (reason: unknown): Promise<V>

  /**
   * Whether this handler would catch `reason` when passed to `.catch()`, whether it then recovers or re-throws.
   * Evaluates the matchers only - no effect runs.
   */
  readonly catches: (reason: unknown) => boolean

  /**
   * The chains this handler chooses between, in order. A nested {@link firstErr} handler contributes its chains here
   * when the outer one is built, so the outer handler searches one flat list and each matcher is evaluated at most once
   * per rejection. Internal: the symbol is not exported from the package.
   */
  readonly [CHAINS]: readonly Chain<V>[]
}

export type HandlerValue<H> = H extends CatchHandler<infer V> ? V : never

/**
 * Builds the handler that gives a rejection to the first of `chains` that catches it and re-throws it unchanged when
 * none does. Each chain's matcher is evaluated at most once per call.
 */
export const handlerOf = <V>(...chains: readonly Chain<V>[]): CatchHandler<V> => {
  const firstCatching = (reason: unknown): Chain<V> | undefined => chains.find(chain => chain.catches(reason))

  const handler = async (reason: unknown): Promise<V> => {
    const chain = firstCatching(reason)
    if (chain !== undefined) {
      return chain.sink(reason)
    }
    throw reason
  }

  return Object.assign(handler, {
    catches: (reason: unknown): boolean => firstCatching(reason) !== undefined,
    [CHAINS]: chains,
  })
}

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
export const firstErr = <H extends readonly [CatchHandler<unknown>, ...CatchHandler<unknown>[]]>(...handlers: H): CatchHandler<HandlerValue<H[number]>> =>
  // Every handler resolves with its own value type, so each of its chains resolves with a member of the union.
  handlerOf(...handlers.flatMap(handler => handler[CHAINS]) as readonly Chain<HandlerValue<H[number]>>[])
