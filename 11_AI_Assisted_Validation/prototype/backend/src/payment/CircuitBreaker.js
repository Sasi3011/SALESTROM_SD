// Circuit Breaker: stops hammering a failing dependency and fails fast instead.
// CLOSED --(N consecutive infra failures)--> OPEN --(cool-down)--> HALF_OPEN --(1 trial ok)--> CLOSED
// Business declines (card_declined) are successful calls and do NOT trip the breaker.
export class CircuitOpenError extends Error { constructor() { super('circuit open'); this.retryable = true; } }

export class CircuitBreaker {
  constructor({ name, failureThreshold = 5, openMs = 1200, clock, onChange }) {
    Object.assign(this, { name, failureThreshold, openMs, clock, onChange });
    this.state = 'CLOSED'; this.failures = 0; this.openedAt = 0; this.trialInFlight = false;
    this.rejected = 0; this.trips = 0;
  }
  async call(fn) {
    if (this.state === 'OPEN') {
      if (this.clock.now() - this.openedAt < this.openMs) { this.rejected++; throw new CircuitOpenError(); }
      this.#set('HALF_OPEN');
    }
    if (this.state === 'HALF_OPEN') {
      if (this.trialInFlight) { this.rejected++; throw new CircuitOpenError(); }
      this.trialInFlight = true;
    }
    try {
      const r = await fn();
      this.failures = 0;
      if (this.state === 'HALF_OPEN') this.#set('CLOSED');
      return r;
    } catch (err) {
      if (err.retryable) {
        this.failures++;
        if (this.state === 'HALF_OPEN' || this.failures >= this.failureThreshold) {
          this.openedAt = this.clock.now();
          if (this.state !== 'OPEN') this.trips++;
          this.#set('OPEN');
        }
      }
      throw err;
    } finally {
      this.trialInFlight = false;
    }
  }
  #set(s) { if (this.state !== s) { this.state = s; this.onChange?.(s); } }
}
