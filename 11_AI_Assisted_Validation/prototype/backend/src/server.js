// SALESTORM validation server.
//  /api/simulations   run the practical test case and stream live state over Server-Sent Events
//  /api/benchmarks    compare concurrency-control strategies on one hot inventory row
//  /api/v1/...        a small "sandbox" of the real REST contract for Postman / curl demos
import express from 'express';
import cors from 'cors';
import { LoadSimulator } from './simulation/LoadSimulator.js';
import { DEFAULT_CONFIG, mergeConfig } from './simulation/config.js';
import { runBenchmark } from './simulation/Benchmark.js';
import { createSystem } from './simulation/System.js';
import { StrategyFactory } from './inventory/strategies/StrategyFactory.js';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const app = express();
app.use(cors());
app.use(express.json({ limit: '64kb' }));

let sim = null;
let lastSnapshot = null;
const clients = new Set();
const history = [];

function broadcast(type, data) {
  const msg = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) res.write(msg);
}

app.get('/api/health', (_req, res) => res.json({ ok: true, running: !!sim?.running }));
app.get('/api/config/defaults', (_req, res) => res.json({ defaults: DEFAULT_CONFIG, strategies: StrategyFactory.names() }));

app.get('/api/stream', (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.write('retry: 2000\n\n');
  clients.add(res);
  if (lastSnapshot) res.write(`event: snapshot\ndata: ${JSON.stringify(lastSnapshot)}\n\n`);
  req.on('close', () => clients.delete(res));
});

app.post('/api/simulations', (req, res) => {
  if (sim?.running) return res.status(409).json({ error: 'SIMULATION_RUNNING' });
  const config = mergeConfig(req.body || {});
  try { StrategyFactory.create(config.strategy); } catch (e) { return res.status(400).json({ error: e.message }); }
  sim = new LoadSimulator(config, {
    onSnapshot: (s) => { lastSnapshot = s; broadcast('snapshot', s); },
    onDone: (s) => {
      lastSnapshot = s;
      history.unshift({
        id: history.length + 1, finishedAt: new Date().toISOString(), config: s.config,
        pipeline: s.pipeline, outcomes: s.outcomes, invariants: s.invariants, summary: s.summary,
      });
      history.splice(10);
      broadcast('snapshot', s); broadcast('done', { ok: s.invariants.every((i) => i.status === 'pass') });
    },
  });
  sim.run().catch((e) => { console.error(e); broadcast('error', { message: e.message }); });
  res.status(202).json({ status: 'STARTED', config });
});

app.get('/api/simulations/current', (_req, res) => res.json(lastSnapshot ?? { phase: 'idle' }));
app.get('/api/simulations/history', (_req, res) => res.json(history));

app.get('/api/traces', (req, res) => {
  if (!sim) return res.json({ items: [], summary: { outcomes: {}, tags: {} } });
  const { outcome, tag, limit } = req.query;
  res.json({ items: sim.system.tracer.list({ outcome, tag, limit: Math.min(Number(limit) || 60, 200) }), summary: sim.system.tracer.summary() });
});
app.get('/api/traces/:id', (req, res) => {
  const t = sim?.system.tracer.get(req.params.id);
  return t ? res.json(t) : res.status(404).json({ error: 'TRACE_NOT_FOUND' });
});

app.post('/api/benchmarks', async (req, res) => {
  const { users, stock, minLatency, maxLatency } = req.body || {};
  const results = await runBenchmark({ users: Number(users) || 2000, stock: Number(stock) || 100, latency: { min: Number(minLatency) || 1, max: Number(maxLatency) || 4 } });
  res.json({ results });
});

// ---------------- Sandbox: the public REST contract from 05_API ----------------
let sandbox = createSystem(mergeConfig({ orderOutage: { enabled: false }, lostResponsePct: 0, reservationTtlMs: 120000 }));
const auth = (req, res) => {
  const token = (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const customerId = req.get('x-customer-id');
  if (!token || !customerId) { res.status(401).json({ error: 'UNAUTHENTICATED', message: 'Send Authorization: Bearer <token> and X-Customer-Id' }); return null; }
  return { token, customerId };
};

app.post('/api/v1/sales/:saleId/reservations', async (req, res) => {
  const who = auth(req, res); if (!who) return;
  const r = await sandbox.api.postReservation({ ...who, idempotencyKey: req.get('idempotency-key'), productId: req.body?.productId, qty: req.body?.quantity, traceId: who.customerId });
  if (r.body.replayed) res.set('Idempotent-Replayed', 'true');
  res.status(r.status).json(r.body);
});
app.post('/api/v1/checkout/payments', async (req, res) => {
  const who = auth(req, res); if (!who) return;
  const r = await sandbox.api.postPayment({ ...who, idempotencyKey: req.get('idempotency-key'), reservationId: req.body?.reservationId, traceId: who.customerId });
  if (r.body.replayed) res.set('Idempotent-Replayed', 'true');
  res.status(r.status).json(r.body);
});
app.get('/api/v1/reservations/:id', (req, res) => {
  const r = sandbox.reservations.get(req.params.id);
  return r ? res.json({ ...sandbox.reservations.view(r), history: r.history }) : res.status(404).json({ error: 'NOT_FOUND' });
});
app.get('/api/v1/orders/by-reservation/:id', (req, res) => {
  const o = sandbox.orders.orders.get(req.params.id);
  return o ? res.json(o) : res.status(404).json({ error: 'NOT_FOUND' });
});
app.get('/api/v1/inventory/:productId', (_req, res) => res.json(sandbox.repo.snapshot()));
app.post('/api/v1/sandbox/reset', (_req, res) => {
  sandbox.stop();
  sandbox = createSystem(mergeConfig({ orderOutage: { enabled: false }, lostResponsePct: 0, reservationTtlMs: 120000 }));
  res.json({ ok: true });
});

// Serve the built dashboard (frontend/dist) so a single `npm start` runs the whole demo.
const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../frontend/dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`SALESTORM engine listening on http://localhost:${PORT}`));
