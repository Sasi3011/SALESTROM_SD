// Validation evidence for traffic distribution: least-request routing and health-check failover.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LoadBalancer } from '../src/gateway/LoadBalancer.js';
import { LoadSimulator } from '../src/simulation/LoadSimulator.js';
import { mergeConfig } from '../src/simulation/config.js';
import { Clock } from '../src/core/Clock.js';
import { Tracer } from '../src/core/Tracer.js';
import { sleep, rand } from '../src/core/util.js';

const makeLb = () => { const clock = new Clock(); return new LoadBalancer({ podsPerZone: 2, clock, tracer: new Tracer(clock) }); };
const burst = (lb, n) => Promise.all(Array.from({ length: n }, async (_, i) => {
  await sleep(rand(0, 20));
  return lb.route(() => sleep(rand(1, 6)).then(() => ({ status: 200 })), `C${i}`);
}));

test('least-request routing spreads 1,200 requests across all 6 pods (none above 2x the average)', async () => {
  const lb = makeLb();
  await burst(lb, 1200);
  const { pods } = lb.stats();
  const avg = 1200 / pods.length;
  assert.equal(pods.reduce((a, p) => a + p.handled, 0), 1200);
  for (const p of pods) {
    assert.ok(p.handled > 0, `${p.id} received no traffic`);
    assert.ok(p.handled <= 2 * avg, `${p.id} handled ${p.handled}, average ${avg}`);
  }
});

test('an unhealthy pod receives 0 new requests and the other pods absorb the load', async () => {
  const lb = makeLb();
  lb.setHealthy('gw-a1', false);
  await burst(lb, 1000);
  const { pods, routedToUnhealthy } = lb.stats();
  const dead = pods.find((p) => p.id === 'gw-a1');
  assert.equal(dead.handled, 0);
  assert.equal(routedToUnhealthy, 0);
  const alive = pods.filter((p) => p.healthy);
  assert.equal(alive.reduce((a, p) => a + p.handled, 0), 1000);
  for (const p of alive) assert.ok(p.handled > 0 && p.handled <= 2 * (1000 / alive.length), `${p.id} handled ${p.handled}`);

  lb.setHealthy('gw-a1', true);
  await burst(lb, 300);
  assert.ok(lb.stats().pods.find((p) => p.id === 'gw-a1').handled > 0, 'recovered pod should rejoin rotation');
});

test('no healthy pod left: load balancer answers 503 NO_HEALTHY_UPSTREAM', async () => {
  const lb = makeLb();
  for (const p of lb.pods) lb.setHealthy(p.id, false);
  const r = await lb.route(async () => ({ status: 200 }), 'C1');
  assert.equal(r.status, 503);
  assert.equal(r.body.error, 'NO_HEALTHY_UPSTREAM');
});

test('pod failure mid-sale: traffic rerouted, bots blocked, every invariant holds', { timeout: 60000 }, async () => {
  const sim = new LoadSimulator(mergeConfig({ users: 3000, arrivalWindowMs: 2000, orderOutage: { enabled: false },
    podFailure: { enabled: true, startMs: 300, durationMs: 1500, podId: 'gw-a1' } }));
  let final;
  sim.onDone = (s) => { final = s; };
  await sim.run();
  for (const inv of final.invariants) assert.equal(inv.status, 'pass', `${inv.label}: ${inv.detail}`);
  assert.equal(final.lb.routedToUnhealthy, 0);
  assert.ok(final.tags.REROUTED > 0, 'requests during the outage should be tagged REROUTED');
  assert.equal(final.pipeline.edgeReceived, 3000);
  assert.equal(final.outcomes.BLOCKED_BOT ?? 0, final.pipeline.botsBlocked);
});
