/**
 * One built catch chain: a matcher together with the operations it guards.
 * Plain data - {@link catchHandlerOf} runs it.
 * A single handler has one chain.
 * A {@link firstErr} handler has the chains of every handler it was combined from.
 *
 * The operations take `unknown` because one handler holds chains for different error types.
 * The handler only ever passes them a reason this chain's matcher has accepted.
 */
export type CatchChain<V> = {
  /**
   * Decides whether this chain catches `reason`. Runs no operation.
   */
  readonly matcher: (reason: unknown) => boolean

  /**
   * The effects added with `.do()`, run in order, each awaited before the next.
   */
  readonly intermediateOperations: readonly ((reason: unknown) => unknown)[]

  /**
   * Produces the outcome once the intermediate operations have run:
   * resolves with the recovery value for `.return()`, rejects for `.throw()`.
   */
  readonly terminalOperation: (reason: unknown) => Promise<V>
}
