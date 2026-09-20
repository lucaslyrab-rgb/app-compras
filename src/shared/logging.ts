const forbiddenKeys = /password|token|cookie|secret|authorization|webhook/i;

export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, forbiddenKeys.test(key) ? "[REDACTED]" : redact(item)]));
  }
  return value;
}

export function log(level: "info" | "warn" | "error", message: string, context: Record<string, unknown> = {}) {
  process.stdout.write(`${JSON.stringify({ level, message, ...(redact(context) as Record<string, unknown>), timestamp: new Date().toISOString() })}\n`);
}
