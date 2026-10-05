import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LoadSimulator } from '../src/simulation/LoadSimulator.js';
import { mergeConfig } from '../src/simulation/config.js';

test('practical test case (scaled): every invariant holds after Order Service outage', { timeout: 60000 }, async () => {
  const sim = new LoadSimulator(mergeConfig({ users: 3000, arrivalWindowMs: 2000, orderOutage: { enabled: true, startMs: 800, durationMs: 1500 } }));
  let final;
  sim.onDone = (s) => { final = s; };
  await sim.run();
  for (const inv of final.invariants) assert.equal(inv.status, 'pass', `${inv.label}: ${inv.detail}`);
  assert.ok(final.inventory.sold <= 100);
  assert.ok(final.pipeline.consumerRetries > 0, 'outage should have caused consumer retries');
});
