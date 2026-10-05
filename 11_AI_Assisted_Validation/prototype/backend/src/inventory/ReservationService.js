// Inventory & Reservation Service.
// SRP: owns reservation lifecycle + stock counters. Knows nothing about payments or orders;
// it reacts to their events (PaymentSucceeded / PaymentFailed / OrderConfirmed).
import { RESERVATION_TRANSITIONS, transition } from './ReservationStateMachine.js';
import { newId } from '../core/util.js';

const ACTIVE = new Set(['RESERVED', 'PAYMENT_PENDING', 'CONFIRMED']);

export class ReservationService {
  constructor({ repo, gate, gateEnabled, strategy, idempotency, outbox, tracer, metrics, clock, ttlMs }) {
    Object.assign(this, { repo, gate, gateEnabled, strategy, idempotency, outbox, tracer, metrics, clock, ttlMs });
    this.reservations = new Map();      // reservation_id -> row
    this.activeByCustomer = new Map();  // models partial UNIQUE (sale_id, customer_id) WHERE status is active
    this.units = Array(repo.stock).fill(null); // visual slot per physical unit
    this.oversold = 0;
    this.sweeper = setInterval(() => this.expireStale(), 100);
  }

  // ---- Command: reserve -------------------------------------------------------------
  reserve({ customerId, idempotencyKey, qty = 1, traceId }) {
    return this.idempotency.execute(`reserve:${idempotencyKey}`,
      () => this.#reserve({ customerId, idempotencyKey, qty, traceId }),
      (r) => r.status === 'RESERVED' || r.status === 'LIMIT_EXCEEDED');
  }

  async #reserve({ customerId, idempotencyKey, qty, traceId }) {
    if (this.activeByCustomer.has(customerId)) {
      this.tracer.span(traceId, 'Inventory', 'rejected: customer already holds an active reservation (1 per customer)', 'warn');
      return { status: 'LIMIT_EXCEEDED' };
    }
    this.activeByCustomer.set(customerId, 'PENDING'); // claim the unique slot before any await

    if (this.gateEnabled && !this.gate.tryAcquire(qty)) {
      this.activeByCustomer.delete(customerId);
      this.metrics.inc('reserve.rejected_at_gate');
      this.tracer.span(traceId, 'Redis gate', 'stock tokens = 0, rejected in memory (database not touched)', 'debug');
      return { status: 'SOLD_OUT', rejectedAt: 'gate' };
    }
    if (this.gateEnabled) this.tracer.span(traceId, 'Redis gate', `token acquired (${this.gate.tokens} left)`);

    const started = this.clock.now();
    const result = await this.strategy.reserve(this.repo, qty);
    this.metrics.observe('db.reserve', this.clock.now() - started);
    this.metrics.inc('reserve.db_attempts');
    if (result.conflicts) this.metrics.inc('reserve.version_conflicts', result.conflicts);

    if (!result.ok) {
      this.activeByCustomer.delete(customerId);
      if (this.gateEnabled) this.gate.release(qty);
      this.metrics.inc(result.reason === 'CONTENTION' ? 'reserve.contention' : 'reserve.rejected_at_db');
      this.tracer.span(traceId, 'Inventory DB', result.reason === 'CONTENTION'
        ? `gave up after ${result.conflicts} version conflicts` : 'guard failed: available < qty (0 rows updated)',
        result.reason === 'CONTENTION' ? 'warn' : 'debug');
      return { status: result.reason };
    }

    // Same transaction as the stock decrement in production: INSERT inventory_reservation.
    const now = this.clock.now();
    const slot = this.units.indexOf(null);
    if (slot === -1) this.oversold++;
    else this.units[slot] = 'R';
    const r = {
      id: newId('rsv'), customerId, idempotencyKey, qty, status: 'RESERVED', traceId,
      createdAt: now, expiresAt: now + this.ttlMs, slot, history: [],
    };
    this.reservations.set(r.id, r);
    this.activeByCustomer.set(customerId, r.id);
    this.metrics.inc('reserve.success');
    this.tracer.span(traceId, 'Inventory DB', `reserved 1 unit (${r.id}), expires in ${this.ttlMs} ms${slot === -1 ? ' — OVERSOLD, no physical unit left' : ''}`,
      slot === -1 ? 'error' : 'success');
    this.outbox.append('ReservationCreated', { reservationId: r.id, customerId, traceId });
    return { status: 'RESERVED', reservation: this.view(r) };
  }

  // ---- Commands used by Checkout --------------------------------------------------------
  // Conditional: only a live (not expired) RESERVED row can start payment.
  // SQL: UPDATE inventory_reservation SET status='PAYMENT_PENDING' WHERE id=? AND status='RESERVED' AND expires_at > now()
  startPayment(reservationId) {
    const r = this.reservations.get(reservationId);
    if (!r) return { ok: false, reason: 'NOT_FOUND' };
    if (r.status !== 'RESERVED') return { ok: false, reason: r.status };
    if (r.expiresAt <= this.clock.now()) return { ok: false, reason: 'EXPIRED' };
    this.#move(r, 'PAYMENT_PENDING', 'P');
    return { ok: true };
  }
  // Gateway circuit is open: hand the hold back so the customer can retry before expiry.
  resumeHold(reservationId) {
    const r = this.reservations.get(reservationId);
    if (r?.status === 'PAYMENT_PENDING') this.#move(r, 'RESERVED', 'R');
  }

  // ---- Event handlers (idempotent: replays are no-ops) ------------------------------------
  async onPaymentSucceeded({ reservationId, traceId }) {
    const r = this.reservations.get(reservationId);
    if (!r || r.status !== 'PAYMENT_PENDING') return;
    this.#move(r, 'CONFIRMED', 'C');
    await this.repo.commitSale(r.qty);
    this.tracer.span(traceId, 'Inventory', 'reservation CONFIRMED: reserved -1, sold +1', 'success');
  }
  async onPaymentFailed({ reservationId, traceId }) {
    const r = this.reservations.get(reservationId);
    if (!r || r.status !== 'PAYMENT_PENDING') return;
    this.#move(r, 'PAYMENT_FAILED');
    await this.#release(r, 'payment failed');
  }
  async onOrderConfirmed({ reservationId, traceId }) {
    const r = this.reservations.get(reservationId);
    if (!r || r.status !== 'CONFIRMED') return;
    this.#move(r, 'SOLD', 'S');
    this.activeByCustomer.delete(r.customerId);
    this.tracer.span(traceId, 'Inventory', 'reservation SOLD (final)');
  }

  // ---- Expiry sweeper ---------------------------------------------------------------------
  // SQL: SELECT ... WHERE status='RESERVED' AND expires_at < now() FOR UPDATE SKIP LOCKED LIMIT 500
  // PAYMENT_PENDING rows are NOT expired here: their money may be moving. The payment
  // reconciler owns them, which removes the "paid after expiry" race entirely.
  async expireStale() {
    const now = this.clock.now();
    for (const r of this.reservations.values()) {
      if (r.status === 'RESERVED' && r.expiresAt <= now) {
        this.#move(r, 'TIMEOUT');
        this.tracer.outcome(r.traceId, 'EXPIRED');
        this.metrics.inc('reserve.expired');
        this.outbox.append('ReservationExpired', { reservationId: r.id, customerId: r.customerId, traceId: r.traceId });
        await this.#release(r, 'reservation expired (TTL)');
      }
    }
  }

  async #release(r, why) {
    this.#move(r, 'RELEASED', null);
    await this.repo.release(r.qty);
    if (this.gateEnabled) this.gate.release(r.qty);
    this.activeByCustomer.delete(r.customerId);
    this.metrics.inc('reserve.released');
    this.tracer.span(r.traceId, 'Inventory', `${why}: unit RELEASED back to stock`, 'warn');
  }

  #move(r, to, unitState) {
    transition(r, to, RESERVATION_TRANSITIONS, this.clock.now());
    if (r.slot >= 0 && unitState !== undefined) this.units[r.slot] = unitState;
  }

  get(id) { return this.reservations.get(id); }
  view(r) { return { reservationId: r.id, status: r.status, expiresAt: r.expiresAt, qty: r.qty }; }
  activeCount() { let n = 0; for (const r of this.reservations.values()) if (ACTIVE.has(r.status)) n++; return n; }
  countByStatus() {
    const c = {};
    for (const r of this.reservations.values()) c[r.status] = (c[r.status] || 0) + 1;
    return c;
  }
  unitString() { return this.units.map((u) => u ?? 'A').join(''); }
  stop() { clearInterval(this.sweeper); }
}
