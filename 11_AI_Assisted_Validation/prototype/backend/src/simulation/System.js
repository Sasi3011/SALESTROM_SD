// Composition root: the single place where concrete classes are chosen and wired.
// Every service receives its dependencies (DIP), so tests and the simulator can swap any part.
import { Clock } from '../core/Clock.js';
import { Tracer } from '../core/Tracer.js';
import { Metrics } from '../core/Metrics.js';
import { EventBus } from '../core/EventBus.js';
import { Outbox } from '../core/Outbox.js';
import { InventoryRepository } from '../inventory/InventoryRepository.js';
import { AdmissionGate } from '../inventory/AdmissionGate.js';
import { IdempotencyStore } from '../inventory/IdempotencyStore.js';
import { ReservationService } from '../inventory/ReservationService.js';
import { StrategyFactory } from '../inventory/strategies/StrategyFactory.js';
import { PaymentProviderFactory } from '../payment/PaymentProviderFactory.js';
import { CircuitBreaker } from '../payment/CircuitBreaker.js';
import { PaymentService } from '../payment/PaymentService.js';
import { OrderService } from '../order/OrderService.js';
import { NotificationService } from '../notification/NotificationService.js';
import { CheckoutFacade } from '../checkout/CheckoutFacade.js';
import { TokenBucket } from '../gateway/RateLimiter.js';
import { ApiGateway } from '../gateway/ApiGateway.js';

export function createSystem(config, { onLog } = {}) {
  const clock = new Clock();
  const flags = { orderDown: false, gatewayDown: false };
  const tracer = new Tracer(clock, onLog);
  const metrics = new Metrics();
  const bus = new EventBus({ metrics, tracer });
  const outbox = new Outbox(bus);
  const idempotency = new IdempotencyStore();

  const repo = new InventoryRepository({ stock: config.stock, latency: config.dbLatency });
  const gate = new AdmissionGate(config.stock);
  const reservations = new ReservationService({
    repo, gate, gateEnabled: config.gateEnabled, strategy: StrategyFactory.create(config.strategy),
    idempotency, outbox, tracer, metrics, clock, ttlMs: config.reservationTtlMs,
  });

  const gateway = PaymentProviderFactory.create(config.paymentMethod, {
    successPct: config.paymentSuccessPct, lostResponsePct: config.lostResponsePct, clock, isDown: () => flags.gatewayDown,
  });
  const breaker = new CircuitBreaker({
    name: 'psp', clock,
    onChange: (s) => tracer.span('system', 'Circuit breaker', `payment gateway circuit is now ${s}`, s === 'OPEN' ? 'error' : 'info'),
  });
  const payments = new PaymentService({ gateway, breaker, outbox, tracer, metrics, clock, timeoutMs: config.paymentTimeoutMs, amount: 499900 });
  const orders = new OrderService({ outbox, tracer, metrics, clock, isDown: () => flags.orderDown });
  const notifications = new NotificationService({ tracer, metrics });

  // Event subscriptions (each group = an independent Kafka consumer group).
  bus.subscribe('inventory-service', ['PaymentSucceeded', 'PaymentFailed', 'OrderConfirmed'], async (topic, e) => {
    if (topic === 'PaymentSucceeded') await reservations.onPaymentSucceeded(e);
    if (topic === 'PaymentFailed') await reservations.onPaymentFailed(e);
    if (topic === 'OrderConfirmed') await reservations.onOrderConfirmed(e);
  });
  bus.subscribe('order-service', ['CheckoutStarted', 'PaymentSucceeded', 'PaymentFailed'], (t, e) => orders.handle(t, e), { maxAttempts: 25 });
  bus.subscribe('fulfilment-service', ['OrderConfirmed'], async (_t, e) => orders.startProcessing(e), { maxAttempts: 25 });
  bus.subscribe('notification-service', ['OrderConfirmed', 'PaymentFailed', 'ReservationExpired'], (t, e) => notifications.handle(t, e));

  const checkout = new CheckoutFacade({ reservations, payments, idempotency, outbox, tracer, clock });
  const api = new ApiGateway({ checkout, limiter: new TokenBucket(config.rateLimit), metrics, tracer });

  // Background reconciler: resolves UNKNOWN payments, replays DLQ once consumers are healthy.
  const reconciler = setInterval(() => {
    payments.reconcile();
    if (!flags.orderDown && bus.dlq.length) bus.replayDlq();
  }, 300);

  const stop = () => { clearInterval(reconciler); reservations.stop(); outbox.stop(); bus.stopped = true; };

  return { config, clock, flags, tracer, metrics, bus, outbox, idempotency, repo, gate, reservations, gateway, breaker, payments, orders, notifications, checkout, api, stop };
}
