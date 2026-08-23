export class AsyncTimeoutError extends Error {
  readonly timeoutMs: number;
  readonly operation: string;

  constructor(operation: string, timeoutMs: number) {
    super(`${operation} timed out after ${timeoutMs}ms`);
    this.name = "AsyncTimeoutError";
    this.operation = operation;
    this.timeoutMs = timeoutMs;
  }
}

export async function withTimeout<T>(
  promise: PromiseLike<T>,
  timeoutMs: number,
  operation = "Async operation",
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  try {
    return await Promise.race([
      Promise.resolve(promise),
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new AsyncTimeoutError(operation, timeoutMs));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
  }
}
