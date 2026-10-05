import { ReservationStrategy } from './ReservationStrategy.js';

// SELECTED APPROACH (see ADR-002).
// One statement: UPDATE ... SET available = available - 1 WHERE available >= 1.
// The database evaluates the guard and the decrement atomically under its row lock,
// for one round trip. Zero affected rows = sold out. No retries, no lost updates.
export class AtomicConditionalUpdate extends ReservationStrategy {
  get name() { return 'atomic'; }
  get description() { return 'Single UPDATE … WHERE available >= qty. Guard and decrement in one step.'; }
  async reserve(repo, qty) {
    const ok = await repo.conditionalReserve(qty);
    return ok ? { ok: true, conflicts: 0 } : { ok: false, reason: 'SOLD_OUT', conflicts: 0 };
  }
}
