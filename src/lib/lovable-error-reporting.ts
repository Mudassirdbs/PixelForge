// Utility placeholder for production error logging if needed in the future.
export function reportError(error: unknown, context: Record<string, unknown> = {}) {
  if (typeof window === "undefined") return;
  console.error("Application error:", error, context);
}
