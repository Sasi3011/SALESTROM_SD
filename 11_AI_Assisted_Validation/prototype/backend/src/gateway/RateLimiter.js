// Token bucket at the API gateway (global sale endpoint limit).
// Burst capacity absorbs the first spike; excess gets HTTP 429 + Retry-After so clients
// back off instead of hammering. Production: per-user + per-IP buckets in Redis as well.
export class TokenBucket {
  constructor({ capacity, refillPerSec }) {
    this.capacity = capacity; this.tokens = capacity; this.refillPerSec = refillPerSec; this.last = Date.now();
  }
  tryTake() {
    const now = Date.now();
    this.tokens = Math.min(this.capacity, this.tokens + ((now - this.last) / 1000) * this.refillPerSec);
    this.last = now;
    if (this.tokens >= 1) { this.tokens -= 1; return true; }
    return false;
  }
}
