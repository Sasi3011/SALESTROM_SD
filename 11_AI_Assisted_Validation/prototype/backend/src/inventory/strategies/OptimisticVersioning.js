import { ReservationStrategy } from './ReservationStrategy.js';
import { sleep, rand } from '../../core/util.js';

// Optimistic concurrency with a version column (compare-and-set).
// Correct, no locks held, but under a hot-row stampede most writers lose the race
// and must retry, multiplying database calls. Bounded retries -> CONTENTION response.
export class OptimisticVersioning extends ReservationStrategy {
  constructor({ maxRetries = 6 } = {}) { super(); this.maxRetries = maxRetries; }
  get name() { return 'optimistic'; }
  get description() { return 'Read version, UPDATE … WHERE version = ?. Retry on conflict.'; }
  async reserve(repo, qty) {
    let conflicts = 0;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const row = await repo.read();
      if (row.available < qty) return { ok: false, reason: 'SOLD_OUT', conflicts };
      const ok = await repo.compareAndSet(row.version, { available: row.available - qty, reserved: row.reserved + qty });
      if (ok) return { ok: true, conflicts };
      conflicts++;
      await sleep(rand(0, 2 + attempt * 3)); // jittered backoff
    }
    return { ok: false, reason: 'CONTENTION', conflicts };
  }
}
