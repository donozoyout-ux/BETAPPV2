export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export class CircuitBreaker {
  private failures = 0;
  private openedAt = 0;

  constructor(private readonly threshold = 3, private readonly cooldownMs = 5 * 60_000) {}

  state(now = Date.now()): CircuitState {
    if (this.failures < this.threshold) return 'CLOSED';
    return now - this.openedAt >= this.cooldownMs ? 'HALF_OPEN' : 'OPEN';
  }

  canRequest(now = Date.now()) { return this.state(now) !== 'OPEN'; }
  success() { this.failures = 0; this.openedAt = 0; }
  failure(now = Date.now()) {
    this.failures += 1;
    if (this.failures >= this.threshold) this.openedAt = now;
  }
  failureCount() { return this.failures; }
}
