type Attempt = { count: number; resetAt: number };

export class LoginRateLimiter {
  private attempts = new Map<string, Attempt>();
  constructor(private readonly limit = 5, private readonly windowMs = 15 * 60 * 1000) {}

  consume(key: string, now = Date.now()) {
    const safeKey = key.toLowerCase().trim();
    const current = this.attempts.get(safeKey);
    if (!current || current.resetAt <= now) {
      this.attempts.set(safeKey, { count: 1, resetAt: now + this.windowMs });
      return { allowed: true, remaining: this.limit - 1 };
    }
    if (current.count >= this.limit) return { allowed: false, remaining: 0, retryAfterMs: current.resetAt - now };
    current.count += 1;
    return { allowed: true, remaining: this.limit - current.count };
  }

  clear(key: string) { this.attempts.delete(key.toLowerCase().trim()); }
}
