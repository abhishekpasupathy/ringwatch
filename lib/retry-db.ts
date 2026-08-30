type RetryOptions = {
  retries?: number;
  baseDelayMs?: number;
};

const TRANSIENT_PRISMA_CODES = new Set(["P1001", "P1008", "P1017"]);

function isTransientDatabaseError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = "code" in error ? String((error as { code?: unknown }).code) : "";
  return TRANSIENT_PRISMA_CODES.has(code);
}

export async function retryDatabaseOperation<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const retries = options.retries ?? 5;
  const baseDelayMs = options.baseDelayMs ?? 500;

  for (let attempt = 0; ; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (!isTransientDatabaseError(error) || attempt >= retries) {
        throw error;
      }

      const delay = baseDelayMs * 2 ** attempt;
      console.warn(
        `Transient database error; retrying in ${delay}ms (attempt ${attempt + 1}/${retries})`
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

export { isTransientDatabaseError };
