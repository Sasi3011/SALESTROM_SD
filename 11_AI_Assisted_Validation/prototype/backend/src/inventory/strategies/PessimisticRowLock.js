import { ReservationStrategy } from './ReservationStrategy.js';

// SELECT ... FOR UPDATE, then UPDATE, inside one transaction.
// Correct, but the row lock is held across two round trips, so every request
// (including ones that will find stock = 0) queues behind the lock.
export class PessimisticRowLock extends ReservationStrategy {
  get name() { return 'pessimistic'; }
  get description() { return 'SELECT … FOR UPDATE, then UPDATE. Row lock held for the whole transaction.'; }
  async reserve(repo, qty) {
    await repo.rowLock.acquire();
    try {
      const row = await repo.read();
      if (row.available < qty) return { ok: false, reason: 'SOLD_OUT', conflicts: 0 };
      await repo.write({ available: row.available - qty, reserved: row.reserved + qty });
      return { ok: true, conflicts: 0 };
    } finally {
      repo.rowLock.release();
    }
  }
}
