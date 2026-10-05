// Validation evidence for ADR-002 (concurrency control) and the inventory invariants.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InventoryRepository } from '../src/inventory/InventoryRepository.js';
import { StrategyFactory } from '../src/inventory/strategies/StrategyFactory.js';

async function stampede(strategyName, users, stock) {
  const repo = new InventoryRepository({ stock, latency: { min: 1, max: 4 } });
  const strategy = StrategyFactory.create(strategyName);
  const results = await Promise.all(Array.from({ length: users }, () => strategy.reserve(repo, 1)));
  return { ok: results.filter((r) => r.ok).length, row: repo.snapshot() };
}

test('atomic conditional update: 2,000 buyers, 100 units -> exactly 100 reservations', async () => {
  const { ok, row } = await stampede('atomic', 2000, 100);
  assert.equal(ok, 100);
  assert.equal(row.available, 0);
  assert.equal(row.reserved, 100);
  assert.ok(row.minAvailable >= 0);
});

test('last unit: two simultaneous buyers, exactly one wins', async () => {
  for (let i = 0; i < 50; i++) {
    const { ok, row } = await stampede('atomic', 2, 1);
    assert.equal(ok, 1);
    assert.equal(row.available, 0);
  }
});

test('pessimistic row lock is correct (but serialises every request)', async () => {
  const { ok, row } = await stampede('pessimistic', 400, 100);
  assert.equal(ok, 100);
  assert.equal(row.available + row.reserved, 100);
});

test('optimistic versioning never oversells (may give up under contention)', async () => {
  const { ok, row } = await stampede('optimistic', 1000, 100);
  assert.ok(ok <= 100);
  assert.equal(row.reserved, ok);
  assert.equal(row.available + row.reserved, 100);
});

test('BASELINE: naive read-then-write oversells (this is the bug we design against)', async () => {
  const { ok } = await stampede('naive', 1000, 100);
  assert.ok(ok > 100, `expected overselling, got ${ok}`);
});
