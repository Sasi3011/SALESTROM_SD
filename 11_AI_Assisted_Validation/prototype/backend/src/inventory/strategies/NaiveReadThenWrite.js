import { ReservationStrategy } from './ReservationStrategy.js';

// ANTI-PATTERN kept on purpose as a baseline: read, check in application code, write.
// Two requests can both read available = 1, both pass the check, and both write 0.
// Result: lost updates and more successful reservations than units (overselling).
export class NaiveReadThenWrite extends ReservationStrategy {
  get name() { return 'naive'; }
  get description() { return 'Read, check in code, then write. No locking.'; }
  async reserve(repo, qty) {
    const row = await repo.read();
    if (row.available < qty) return { ok: false, reason: 'SOLD_OUT', conflicts: 0 };
    await repo.write({ available: row.available - qty, reserved: row.reserved + qty });
    return { ok: true, conflicts: 0 };
  }
}
