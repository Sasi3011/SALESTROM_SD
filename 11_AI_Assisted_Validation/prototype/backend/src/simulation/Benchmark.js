// Concurrency lab: fires N simultaneous reservation attempts at one inventory row using each
// strategy, with no admission gate, so the database-level behaviour is visible on its own.
import { InventoryRepository } from '../inventory/InventoryRepository.js';
import { AdmissionGate } from '../inventory/AdmissionGate.js';
import { StrategyFactory } from '../inventory/strategies/StrategyFactory.js';
import { sleep, rand, percentile } from '../core/util.js';

async function runOne(strategyName, { users, stock, latency, withGate }) {
  const repo = new InventoryRepository({ stock, latency });
  const gate = withGate ? new AdmissionGate(stock) : null;
  const strategy = StrategyFactory.create(strategyName);
  const lat = []; let success = 0, soldOut = 0, contention = 0, conflicts = 0, gateRejected = 0;
  const t0 = Date.now();
  await Promise.all(Array.from({ length: users }, async () => {
    await sleep(rand(0, 20));
    const s = Date.now();
    if (gate && !gate.tryAcquire(1)) { gateRejected++; lat.push(Date.now() - s); return; }
    const r = await strategy.reserve(repo, 1);
    lat.push(Date.now() - s);
    conflicts += r.conflicts;
    if (r.ok) success++;
    else { if (gate) gate.release(1); r.reason === 'CONTENTION' ? contention++ : soldOut++; }
  }));
  const row = repo.snapshot();
  return {
    strategy: strategyName + (withGate ? '+gate' : ''), description: strategy.description,
    users, stock, successfulReservations: success, oversold: Math.max(0, success - stock),
    soldOut, contention, gateRejected, versionConflicts: conflicts, dbCalls: row.dbCalls,
    finalRow: { available: row.available, reserved: row.reserved },
    conserved: row.available + row.reserved + row.sold === stock && success === row.reserved,
    p50: percentile(lat, 50), p99: percentile(lat, 99), durationMs: Date.now() - t0,
    correct: success <= stock && row.available + row.reserved === stock && success === row.reserved,
  };
}

export async function runBenchmark({ users = 2000, stock = 100, latency = { min: 1, max: 4 } } = {}) {
  users = Math.min(Math.max(10, users), 5000);
  const results = [];
  for (const name of ['naive', 'pessimistic', 'optimistic', 'atomic']) results.push(await runOne(name, { users, stock, latency, withGate: false }));
  results.push(await runOne('atomic', { users, stock, latency, withGate: true }));
  return results;
}
