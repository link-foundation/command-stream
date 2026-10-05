/**
 * Compile-time assertion helpers for the declaration tests.
 *
 * `expectType<Equal<A, B>>()` only compiles when `A` and `B` are identical.
 */

export type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;

export function expectType<T extends true>(): T | void {}

/** Marks a value as used without evaluating it. */
export function use(..._values: unknown[]): void {}
