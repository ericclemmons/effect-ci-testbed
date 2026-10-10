/** Match the binding's explicit retry contract, never error-message heuristics. */
export function canRetryNativeQuery(error: unknown): boolean {
  try {
    return typeof error === "object" && error !== null && (error as { retryable?: unknown }).retryable === true
  } catch { return false }
}

export const nativeSqlPolicy = {
  retries: { limit: 2, delay: "1 minute", backoff: "exponential" }, timeout: "2 minutes",
} as const
