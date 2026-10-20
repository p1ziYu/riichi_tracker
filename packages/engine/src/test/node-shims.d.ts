declare module 'node:test' {
  export function describe(name: string, fn: () => void | Promise<void>): Promise<void>;
  export function it(name: string, fn: () => void | Promise<void>): Promise<void>;
  export function test(name: string, fn: () => void | Promise<void>): Promise<void>;
}

declare module 'node:assert/strict' {
  export function equal<T>(actual: unknown, expected: T, message?: string): asserts actual is T;
  export function deepEqual<T>(actual: unknown, expected: T, message?: string): asserts actual is T;
  export function ok(value: unknown, message?: string): asserts value;
  export function throws(block: () => unknown, error?: RegExp | Function | Object | Error, message?: string): void;
}
