import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createSystem } from '../src/simulation/System.js';
import { mergeConfig } from '../src/simulation/config.js';
import { sleep } from '../src/core/util.js';

const systems = [];
const make = (o) => { const s = createSystem(mergeConfig({ orderOutage: { enabled: false }, lostResponsePct: 0, ...o })); systems.push(s); return s; };
after(() => systems.forEach((s) => s.stop()));

test('50 concurrent duplicate Buy requests with one key create one reservation', async () => {
  const sys = make({ stock: 10 });
  const req = { customerId: 'C1', idempotencyKey: 'k-1', qty: 1, traceId: 'C1' };
  const results = await Promise.all(Array.from({ length: 50 }, () => sys.checkout.reserve(req)));
  const ids = new Set(results.map((r) => r.reservation?.reservationId));
  assert.equal(ids.size, 1);
  assert.equal(sys.repo.snapshot().reserved, 1);
});

test('one customer cannot hold two reservations with different keys', async () => {
  const sys = make({ stock: 10 });
  const [a, b] = await Promise.all([
    sys.checkout.reserve({ customerId: 'C2', idempotencyKey: 'k-a', qty: 1, traceId: 'C2' }),
    sys.checkout.reserve({ customerId: 'C2', idempotencyKey: 'k-b', qty: 1, traceId: 'C2' }),
  ]);
  assert.deepEqual([a.status, b.status].sort(), ['LIMIT_EXCEEDED', 'RESERVED']);
});

test('duplicate Pay requests charge the card once and confirm one order', async () => {
  const sys = make({ stock: 5, paymentSuccessPct: 100 });
  const r = await sys.checkout.reserve({ customerId: 'C3', idempotencyKey: 'k-3', qty: 1, traceId: 'C3' });
  const pay = { customerId: 'C3', reservationId: r.reservation.reservationId, idempotencyKey: 'p-3', traceId: 'C3' };
  await Promise.all([sys.checkout.pay(pay), sys.checkout.pay(pay), sys.checkout.pay(pay)]);
  await sleep(400);
  assert.deepEqual(sys.gateway.executionsPerKey(), [1]);
  assert.equal(sys.orders.countByStatus().PROCESSING ?? sys.orders.countByStatus().CONFIRMED, 1);
  assert.equal(sys.repo.snapshot().sold, 1);
});

test('failed payment releases the unit back to stock', async () => {
  const sys = make({ stock: 1, paymentSuccessPct: 0 });
  const r = await sys.checkout.reserve({ customerId: 'C4', idempotencyKey: 'k-4', qty: 1, traceId: 'C4' });
  assert.equal(sys.repo.snapshot().available, 0);
  await sys.checkout.pay({ customerId: 'C4', reservationId: r.reservation.reservationId, idempotencyKey: 'p-4', traceId: 'C4' });
  await sleep(300);
  assert.equal(sys.repo.snapshot().available, 1);
  assert.equal(sys.reservations.get(r.reservation.reservationId).status, 'RELEASED');
});

test('unpaid reservation expires after TTL and stock returns', async () => {
  const sys = make({ stock: 1, reservationTtlMs: 200 });
  const r = await sys.checkout.reserve({ customerId: 'C5', idempotencyKey: 'k-5', qty: 1, traceId: 'C5' });
  await sleep(450);
  assert.equal(sys.reservations.get(r.reservation.reservationId).status, 'RELEASED');
  assert.equal(sys.repo.snapshot().available, 1);
});
