/**
 * Failed sign-ins, counted in memory (one API instance; the rate-limit plugin's store is in
 * memory too). Only failures count, so a stranger can't use up an account's allowance by
 * signing in as it successfully, and once an email has had too many failures, only the
 * addresses that took part in them are refused: the real person, from a network that hasn't
 * failed for that email, still gets in. Past three times the allowance (guesses from many
 * networks), the email is refused everywhere. Each address also has a cap across all emails.
 */
export class LoginGuard {
  private readonly failures = new Map<string, number[]>();
  private calls = 0;

  constructor(
    private readonly perEmail: number,
    private readonly perIp: number,
    private readonly windowMs = 15 * 60_000,
  ) {}

  blocked(email: string, ip: string, now = Date.now()): boolean {
    const key = email.trim().toLowerCase();
    const forEmail = this.count(`email|${key}`, now);
    return (
      this.count(`ip|${ip}`, now) >= this.perIp ||
      forEmail >= 3 * this.perEmail ||
      (forEmail >= this.perEmail && this.count(`pair|${key}|${ip}`, now) > 0)
    );
  }

  fail(email: string, ip: string, now = Date.now()) {
    const key = email.trim().toLowerCase();
    for (const k of [`ip|${ip}`, `email|${key}`, `pair|${key}|${ip}`]) {
      this.failures.set(k, [...this.recent(k, now), now]);
    }
    // Forget stale keys now and then, so the map can't grow without bound
    if (++this.calls % 1000 === 0) {
      for (const k of [...this.failures.keys()]) {
        if (this.recent(k, now).length === 0) this.failures.delete(k);
      }
    }
  }

  private recent(key: string, now: number) {
    return (this.failures.get(key) ?? []).filter((t) => now - t < this.windowMs);
  }

  private count(key: string, now: number) {
    return this.recent(key, now).length;
  }
}
