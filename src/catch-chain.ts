import type { AsyncReasonMapper, ErrorEffect } from './catch-chain-builder.types.js';

export type IntermediateOperations<E> = readonly ErrorEffect<E>[]
export type TerminalOperation<E, V> = AsyncReasonMapper<E, V>

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
   * Decides whether this chain catches `reason`: only `true` catches it.
   * **Runs no operation.**
   *
   * Typed to return `unknown` because a chain may come from JavaScript or from another copy of the library,
   * so the handler cannot rely on getting a boolean.
   */
  readonly matcher: (reason: unknown) => unknown

  /**
   * The effects added with `.do()`, run in order, each awaited before the next.
   */
  readonly intermediateOperations: IntermediateOperations<unknown>

  /**
   * Produces the outcome once the intermediate operations have run:
   * resolves with the recovery value for `.return()`, rejects for `.throw()`.
   */
  readonly terminalOperation: TerminalOperation<unknown, V>
}

/**
 * A frozen copy of `chain` and of its intermediate operations list.
 * Shallow: the matcher and operations are the caller's own functions and stay as they are.
 */
export const freezeCatchChain = <V>(chain: CatchChain<V>): CatchChain<V> => Object.freeze({
  ...chain,
  intermediateOperations: Object.freeze([...chain.intermediateOperations]),
})
