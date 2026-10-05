// Facade: one simple entry point for the customer-facing purchase flow, hiding Inventory,
// Payment and the outbox. Synchronous part = what the customer must know right now
// (did I get a unit? did my payment go through?). Everything after payment is async.
export class CheckoutFacade {
  constructor({ reservations, payments, idempotency, outbox, tracer, clock }) {
    Object.assign(this, { reservations, payments, idempotency, outbox, tracer, clock });
  }

  reserve(cmd) { return this.reservations.reserve(cmd); }

  pay({ customerId, reservationId, idempotencyKey, traceId }) {
    return this.idempotency.execute(`pay:${idempotencyKey}`,
      () => this.#pay({ customerId, reservationId, traceId }),
      (r) => r.status !== 'PAYMENT_UNAVAILABLE');
  }

  async #pay({ customerId, reservationId, traceId }) {
    const r = this.reservations.get(reservationId);
    if (!r || r.customerId !== customerId) return { status: 'NOT_FOUND' };            // ownership check
    if (['CONFIRMED', 'SOLD'].includes(r.status)) return { status: 'PAID', reservationId };

    const started = this.reservations.startPayment(reservationId);
    if (!started.ok) {
      if (started.reason === 'PAYMENT_PENDING') return { status: 'PAYMENT_PROCESSING' };
      this.tracer.span(traceId, 'Checkout', `cannot pay: reservation is ${started.reason}`, 'warn');
      return { status: 'RESERVATION_EXPIRED' };
    }
    if (!r.checkoutPublished) {
      this.outbox.append('CheckoutStarted', { reservationId, customerId, traceId });
      r.checkoutPublished = true;
    }
    this.tracer.span(traceId, 'Checkout', 'reservation -> PAYMENT_PENDING, order draft requested');

    const p = await this.payments.charge({ reservationId, customerId, traceId });
    switch (p.status) {
      case 'SUCCEEDED': return { status: 'PAID', paymentId: p.paymentId, order: 'CONFIRMATION_PENDING' };
      case 'FAILED': return { status: 'PAYMENT_FAILED', paymentId: p.paymentId };
      case 'UNKNOWN': return { status: 'PAYMENT_PROCESSING', paymentId: p.paymentId };
      default:
        this.reservations.resumeHold(reservationId);
        return { status: 'PAYMENT_UNAVAILABLE', retryAfterMs: 500 };
    }
  }
}
