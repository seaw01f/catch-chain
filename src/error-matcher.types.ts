/**
 * Type guard that receives an unknown rejection reason and narrows it to a specific error type.
 *
 * Used with {@link onErr} to filter errors in a catch chain.
 *
 * Should not throw: a thrown error replaces the original rejection, and makes `handler.catches(reason)` throw.
 */
export type ErrorMatcher<E extends Error> = (reason: unknown) => reason is E
