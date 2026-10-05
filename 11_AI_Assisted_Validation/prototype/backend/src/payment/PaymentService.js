// Payment Service. Owns the PAYMENT table and the PaymentSucceeded / PaymentFailed events.
// Guarantees: at most one charge per reservation (idempotency key = reservation id, enforced
// by UNIQUE(payment.idempotency_key) here and by the PSP's own key de-duplication).
import { CircuitOpenError } from './CircuitBreaker.js';
import { GatewayTimeoutError } from './PaymentGateway.js';
import { newId } from '../core/util.js';

const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new GatewayTimeoutError()), ms))]);

export class PaymentService {
  constructor({ gateway, breaker, outbox, tracer, metrics, clock, timeoutMs, amount }) {
    Object.assign(this, { gateway, breaker, outbox, tracer, metrics, clock, timeoutMs, amount });
    this.payments = new Map();   // idempotency_key -> PAYMENT row
    this.inflight = new Map();
  }

  charge({ reservationId, customerId, traceId }) {
    const key = `pay_${reservationId}`;
    const row = this.payments.get(key);
    if (row && ['SUCCEEDED', 'FAILED', 'UNKNOWN'].includes(row.status)) {
      this.tracer.span(traceId, 'Payment', `idempotent replay: payment ${row.id} already ${row.status}, no new charge`, 'info');
      return Promise.resolve({ status: row.status, paymentId: row.id, replayed: true });
    }
    if (this.inflight.has(key)) return this.inflight.get(key).then((r) => ({ ...r, replayed: true }));
    const p = this.#charge({ key, reservationId, customerId, traceId }).finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }

  async #charge({ key, reservationId, customerId, traceId, fromReconciler = false }) {
    const row = this.payments.get(key) ?? { id: newId('pay'), key, reservationId, customerId, traceId, amount: this.amount, status: 'INITIATED', attempts: 0, transactionId: null };
    this.payments.set(key, row);
    row.attempts++;
    this.tracer.span(traceId, 'Payment', `calling ${this.gateway.provider} with Idempotency-Key ${key}`);
    try {
      const res = await this.breaker.call(() => withTimeout(this.gateway.charge({ idempotencyKey: key, amount: this.amount, customerId }), this.timeoutMs));
      this.#finalise(row, res.status, res.transactionId, res.declineCode);
      return { status: row.status, paymentId: row.id };
    } catch (err) {
      if (err instanceof CircuitOpenError && fromReconciler) { row.status = 'UNKNOWN'; return { status: 'UNKNOWN', paymentId: row.id }; }
      if (err instanceof CircuitOpenError) {
        this.payments.delete(key);     // nothing was sent, so no money can have moved
        this.metrics.inc('payment.circuit_rejected');
        this.tracer.span(traceId, 'Payment', 'circuit breaker OPEN: failed fast without calling the gateway', 'warn');
        this.tracer.tag(traceId, 'CIRCUIT_OPEN');
        return { status: 'UNAVAILABLE' };
      }
      // Timeout / 503: the charge MAY have happened. Never guess, never blindly re-charge.
      row.status = 'UNKNOWN';
      this.metrics.inc('payment.unknown');
      this.tracer.span(traceId, 'Payment', `${err.message} after ${this.timeoutMs} ms: status UNKNOWN, handed to reconciliation`, 'warn');
      this.tracer.tag(traceId, 'PAYMENT_TIMEOUT');
      return { status: 'UNKNOWN', paymentId: row.id };
    }
  }

  // Same transaction: UPDATE payment + INSERT outbox row.
  #finalise(row, status, transactionId, declineCode) {
    row.status = status; row.transactionId = transactionId;
    this.metrics.inc(status === 'SUCCEEDED' ? 'payment.succeeded' : 'payment.failed');
    this.tracer.span(row.traceId, 'Payment', status === 'SUCCEEDED'
      ? `captured (${transactionId})` : `declined by gateway (${declineCode ?? 'declined'})`, status === 'SUCCEEDED' ? 'success' : 'error');
    this.outbox.append(status === 'SUCCEEDED' ? 'PaymentSucceeded' : 'PaymentFailed',
      { paymentId: row.id, reservationId: row.reservationId, customerId: row.customerId, traceId: row.traceId, transactionId });
  }

  // Reconciliation job: resolves every UNKNOWN payment by ASKING the PSP, using the same key.
  async reconcile() {
    for (const row of this.payments.values()) {
      if (row.status !== 'UNKNOWN' || row.reconciling) continue;
      row.reconciling = true;
      try {
        const s = await this.gateway.getStatus(row.key);
        if (s.status === 'NOT_FOUND') {
          this.tracer.span(row.traceId, 'Reconciler', 'PSP has no record of the charge: safe to retry with the same key');
          row.status = 'INITIATED';
          await this.#charge({ key: row.key, reservationId: row.reservationId, customerId: row.customerId, traceId: row.traceId, fromReconciler: true });
        } else {
          this.metrics.inc('payment.reconciled');
          this.tracer.span(row.traceId, 'Reconciler', `PSP reports ${s.status} for ${row.key}: recording result, no second charge`, 'success');
          this.tracer.tag(row.traceId, 'RECONCILED');
          this.#finalise(row, s.status, s.transactionId);
        }
      } catch { /* PSP still unreachable, try next cycle */ } finally { row.reconciling = false; }
    }
  }

  unresolved() { let n = 0; for (const r of this.payments.values()) if (r.status === 'UNKNOWN' || r.status === 'INITIATED') n++; return n; }
  countByStatus() { const c = {}; for (const r of this.payments.values()) c[r.status] = (c[r.status] || 0) + 1; return c; }
}
