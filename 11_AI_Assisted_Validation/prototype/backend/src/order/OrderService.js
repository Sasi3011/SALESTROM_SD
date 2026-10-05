// Order Service. Purely event-driven: it consumes CheckoutStarted, PaymentSucceeded and
// PaymentFailed. If it is down, events wait in its queue (consumer lag) and are retried
// with backoff; nothing is lost, and the customer's money is already safely recorded.
// Idempotent: one order per reservation (UNIQUE(order.reservation_id)); replays are no-ops.
import { ORDER_TRANSITIONS } from './OrderStateMachine.js';
import { transition } from '../inventory/ReservationStateMachine.js';
import { newId } from '../core/util.js';

export class ServiceUnavailableError extends Error {}

export class OrderService {
  constructor({ outbox, tracer, metrics, clock, isDown }) {
    Object.assign(this, { outbox, tracer, metrics, clock, isDown });
    this.orders = new Map(); // reservation_id -> ORDER row
  }

  async handle(topic, e) {
    if (this.isDown()) throw new ServiceUnavailableError('Order Service 503');
    if (topic === 'CheckoutStarted') return this.#create(e);
    if (topic === 'PaymentSucceeded') return this.#confirm(e);
    if (topic === 'PaymentFailed') return this.#cancel(e);
  }

  #create(e) {
    if (this.orders.has(e.reservationId)) return;
    const o = { id: newId('ord'), reservationId: e.reservationId, customerId: e.customerId, traceId: e.traceId, status: 'CREATED', history: [], paymentId: null };
    this.orders.set(e.reservationId, o);
    transition(o, 'PAYMENT_PENDING', ORDER_TRANSITIONS, this.clock.now());
    this.tracer.span(e.traceId, 'Order', `order ${o.id} CREATED -> PAYMENT_PENDING`);
  }

  #confirm(e) {
    const o = this.orders.get(e.reservationId);
    if (!o) throw new Error('order not found yet'); // cannot happen with ordered delivery; retried if it does
    if (o.status !== 'PAYMENT_PENDING') return;     // duplicate event
    o.paymentId = e.paymentId;
    transition(o, 'CONFIRMED', ORDER_TRANSITIONS, this.clock.now());
    this.metrics.inc('order.confirmed');
    const lag = Date.now() - (e.occurredAt ?? Date.now());
    this.tracer.span(e.traceId, 'Order', `order ${o.id} CONFIRMED${lag > 400 ? ` (${lag} ms after payment, delayed by outage)` : ''}`, 'success');
    if (lag > 400) this.tracer.tag(e.traceId, 'ORDER_DELAYED');
    this.tracer.outcome(e.traceId, 'PURCHASED');
    this.outbox.append('OrderConfirmed', { orderId: o.id, reservationId: o.reservationId, customerId: o.customerId, traceId: o.traceId });
  }

  #cancel(e) {
    const o = this.orders.get(e.reservationId);
    if (!o || o.status === 'CANCELLED') return;
    transition(o, 'CANCELLED', ORDER_TRANSITIONS, this.clock.now());
    this.metrics.inc('order.cancelled');
    this.tracer.span(e.traceId, 'Order', `order ${o.id} CANCELLED (payment failed)`, 'warn');
    this.tracer.outcome(e.traceId, 'PAYMENT_FAILED');
  }

  // Fulfilment hand-off (consumer of OrderConfirmed).
  startProcessing(e) {
    if (this.isDown()) throw new ServiceUnavailableError('Order Service 503');
    const o = this.orders.get(e.reservationId);
    if (!o || o.status !== 'CONFIRMED') return;
    transition(o, 'PROCESSING', ORDER_TRANSITIONS, this.clock.now());
    this.tracer.span(e.traceId, 'Fulfilment', `order ${o.id} PROCESSING: pick-pack requested from warehouse`);
  }

  countByStatus() { const c = {}; for (const o of this.orders.values()) c[o.status] = (c[o.status] || 0) + 1; return c; }
}
