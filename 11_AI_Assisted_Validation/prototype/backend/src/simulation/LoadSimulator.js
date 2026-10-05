// Runs the brief's practical test case: N customers hit "Buy now" for S units at the same time.
// Each customer is an async journey through the real API gateway -> checkout -> services.
import { createSystem } from './System.js';
import { checkInvariants } from './InvariantChecker.js';
import { sleep, rand, chance, percentile } from '../core/util.js';

export class LoadSimulator {
  constructor(config, { onSnapshot, onDone } = {}) {
    this.config = config;
    this.onSnapshot = onSnapshot;
    this.onDone = onDone;
    this.logRing = [];
    this.timeline = [];
    this.running = false;
    this.phase = 'idle';
    this.system = createSystem(config, { onLog: (e) => this.#log(e) });
    this.lastReq = 0;
  }

  #log(e) {
    if (e.level === 'debug') return;
    this.logRing.push(e);
    if (this.logRing.length > 400) this.logRing.splice(0, this.logRing.length - 400);
  }

  async run() {
    const { system: sys, config: c } = this;
    this.running = true; this.phase = 'burst';
    sys.tracer.span('system', 'Simulator', `sale opened: ${c.users.toLocaleString()} customers, ${c.stock} units, strategy=${c.strategy}, gate=${c.gateEnabled ? 'on' : 'off'}`);
    this.#scheduleOutage('orderDown', c.orderOutage, 'Order Service');
    this.#scheduleOutage('gatewayDown', c.gatewayOutage, 'Payment gateway');
    this.ticker = setInterval(() => this.#tick(), 200);

    const journeys = [];
    for (let i = 1; i <= c.users; i++) journeys.push(this.#customer(i));
    await Promise.all(journeys);

    this.phase = 'settling';
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline && !this.#settled()) await sleep(100);
    sys.outbox.relay();
    await sleep(150);

    clearInterval(this.ticker);
    this.#tick();
    this.phase = 'done'; this.running = false;
    sys.tracer.span('system', 'Simulator', 'system settled: all queues drained, all reservations resolved', 'success');
    this.summary = this.#summary();
    sys.stop();
    this.onDone?.(this.snapshot(true));
  }

  #settled() {
    const s = this.system;
    return !s.flags.orderDown && s.outbox.pending() === 0 && s.bus.idle() && s.payments.unresolved() === 0 && s.reservations.activeCount() === 0;
  }

  #scheduleOutage(flag, o, label) {
    if (!o?.enabled) return;
    setTimeout(() => {
      this.system.flags[flag] = true;
      this.system.tracer.span('system', label, `${label} is DOWN (simulated outage for ${o.durationMs} ms)`, 'error');
      setTimeout(() => {
        this.system.flags[flag] = false;
        this.system.tracer.span('system', label, `${label} recovered`, 'success');
      }, o.durationMs);
    }, o.startMs);
  }

  async #customer(i) {
    const { system: sys, config: c } = this;
    const id = `C${String(i).padStart(5, '0')}`;
    const token = `jwt-${id}`;
    const dup = chance(c.duplicatePct);
    const abandon = chance(c.abandonPct);
    sys.tracer.begin(id, { duplicate: dup });
    if (dup) sys.tracer.tag(id, 'DUPLICATE');

    await sleep(c.arrivalWindowMs * Math.random() ** 2.4);   // front-loaded burst
    sys.tracer.span(id, 'Customer', 'clicked Buy now', 'debug');

    const reserveReq = { token, customerId: id, idempotencyKey: `idem-buy-${id}`, productId: 'PRODUCT_X', qty: 1, traceId: id };
    let res;
    for (let attempt = 0; attempt < 4; attempt++) {
      const calls = [sys.api.postReservation(reserveReq)];
      if (dup && attempt === 0) calls.push(sleep(rand(3, 30)).then(() => {
        sys.tracer.span(id, 'Customer', 'double-clicked Buy now (same Idempotency-Key)', 'info');
        return sys.api.postReservation(reserveReq);
      }));
      const results = await Promise.all(calls);
      res = results[0];
      if (results[1]) {
        const r2 = results[1];
        sys.tracer.span(id, 'API gateway', `duplicate request answered ${r2.status}${r2.body.replayed ? ' with the original result (no second reservation)' : ''}`, 'info');
      }
      if (res.status !== 429) break;
      sys.tracer.tag(id, 'RATE_LIMITED_RETRY');
      await sleep(res.body.retryAfterMs + rand(0, 400));
    }

    const st = res.body.status;
    if (res.status === 429) { sys.tracer.outcome(id, 'RATE_LIMITED'); return; }
    if (st === 'SOLD_OUT') { sys.tracer.outcome(id, 'SOLD_OUT'); return; }
    if (st === 'CONTENTION') { sys.tracer.outcome(id, 'CONTENTION'); return; }
    if (st !== 'RESERVED') { sys.tracer.outcome(id, st); return; }

    sys.tracer.outcome(id, 'RESERVED');
    const reservationId = res.body.reservation.reservationId;
    if (abandon) { sys.tracer.tag(id, 'ABANDONED'); sys.tracer.span(id, 'Customer', 'left the checkout page without paying'); return; }

    await sleep(rand(150, 700));     // customer enters payment details
    const payReq = { token, customerId: id, reservationId, idempotencyKey: `idem-pay-${id}`, traceId: id };
    for (let attempt = 0; attempt < 6; attempt++) {
      const calls = [sys.api.postPayment(payReq)];
      if (dup && attempt === 0) calls.push(sleep(rand(3, 30)).then(() => {
        sys.tracer.span(id, 'Customer', 'double-clicked Pay (same Idempotency-Key)');
        return sys.api.postPayment(payReq);
      }));
      const results = await Promise.all(calls);
      const p = results[0];
      if (results[1]) sys.tracer.span(id, 'API gateway', `duplicate Pay answered ${results[1].status} ${results[1].body.status}, no second charge`, 'info');
      if (p.status === 503 || p.status === 429) { await sleep(400 + attempt * 300); continue; }
      if (p.body.status === 'PAYMENT_PROCESSING') sys.tracer.span(id, 'Customer', 'saw "Payment processing, we will confirm shortly"');
      if (p.body.status === 'PAID') sys.tracer.span(id, 'Customer', 'saw "Payment received, confirming your order"');
      return;
    }
  }

  #tick() {
    const s = this.system;
    const inv = s.repo.snapshot();
    const byStatus = s.reservations.countByStatus();
    const req = s.metrics.get('http.requests');
    this.timeline.push({
      t: s.clock.now(), available: inv.available, reserved: byStatus.RESERVED || 0, paying: byStatus.PAYMENT_PENDING || 0,
      sold: inv.sold, orderLag: s.bus.backlog()['order-service'] || 0, rps: Math.round((req - this.lastReq) * 5),
    });
    this.lastReq = req;
    this.onSnapshot?.(this.snapshot());
  }

  snapshot(final = false) {
    const s = this.system; const m = s.metrics;
    const inv = s.repo.snapshot();
    const trace = s.tracer.summary();
    return {
      phase: this.phase, running: this.running, t: s.clock.now(), config: this.config,
      inventory: inv, gateTokens: s.gate.tokens, units: s.reservations.unitString(), oversold: s.reservations.oversold,
      reservations: s.reservations.countByStatus(), payments: s.payments.countByStatus(), orders: s.orders.countByStatus(),
      flags: { ...s.flags }, breaker: s.breaker.state, backlog: s.bus.backlog(), outboxPending: s.outbox.pending(),
      pipeline: {
        customers: this.config.users,
        httpRequests: m.get('http.requests'),
        rateLimited: m.get('http.429'),
        gateRejected: m.get('reserve.rejected_at_gate'),
        dbAttempts: m.get('reserve.db_attempts'),
        dbRejected: m.get('reserve.rejected_at_db'),
        contention: m.get('reserve.contention'),
        versionConflicts: m.get('reserve.version_conflicts'),
        reserved: m.get('reserve.success'),
        expired: m.get('reserve.expired'),
        released: m.get('reserve.released'),
        paymentsSucceeded: m.get('payment.succeeded'),
        paymentsFailed: m.get('payment.failed'),
        paymentsUnknown: m.get('payment.unknown'),
        reconciled: m.get('payment.reconciled'),
        circuitRejected: m.get('payment.circuit_rejected'),
        ordersConfirmed: m.get('order.confirmed'),
        ordersCancelled: m.get('order.cancelled'),
        consumerRetries: m.get('consumer.retries'),
        dlq: m.get('dlq.messages'),
        notifications: m.get('notification.sent'),
        idempotentReplays: s.idempotency.replays,
        pspDedup: s.gateway.dedupHits,
        dbCalls: inv.dbCalls,
      },
      outcomes: trace.outcomes, tags: trace.tags,
      invariants: checkInvariants(s, { final }),
      timeline: this.timeline,
      log: this.logRing.slice(-80),
      summary: this.summary ?? null,
    };
  }

  #summary() {
    const lat = this.system.metrics.latencies['db.reserve'] || [];
    return { durationMs: this.system.clock.now(), dbReserveP50: percentile(lat, 50), dbReserveP99: percentile(lat, 99) };
  }
}
