// Idempotency-Key handling.
//  - Same key while the first call is still running  -> wait for and share its result.
//  - Same key after it finished with a final result  -> replay the stored result.
//  - Retryable results (sold out, rate limited, gateway unavailable) are not stored,
//    so a genuine retry later can still succeed.
// Production: Redis SET key NX EX 24h for the in-flight marker + a UNIQUE(idempotency_key)
// column on the business table as the durable backstop.
export class IdempotencyStore {
  constructor() { this.inflight = new Map(); this.completed = new Map(); this.replays = 0; }
  async execute(key, fn, isFinal = () => true) {
    if (this.completed.has(key)) { this.replays++; return { ...this.completed.get(key), replayed: true }; }
    if (this.inflight.has(key)) { this.replays++; const r = await this.inflight.get(key); return { ...r, replayed: true }; }
    const p = (async () => {
      try {
        const r = await fn();
        if (isFinal(r)) this.completed.set(key, r);
        return r;
      } finally { this.inflight.delete(key); }
    })();
    this.inflight.set(key, p);
    return p;
  }
}
