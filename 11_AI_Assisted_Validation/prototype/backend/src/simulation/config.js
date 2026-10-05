// Defaults mirror the brief's practical test case. Time is compressed 10x so a full
// run takes ~15 s: a 30 s Order Service outage becomes 3,000 ms, a 5 min reservation TTL 2,500 ms.
export const DEFAULT_CONFIG = {
  users: 10000,
  stock: 100,
  arrivalWindowMs: 4000,         // when customers click "Buy now" (front-loaded burst)
  strategy: 'atomic',            // naive | pessimistic | optimistic | atomic
  gateEnabled: true,             // Redis admission gate in front of the DB
  botPct: 1,                     // clients scored as bots by the CDN / WAF and blocked with 403
  duplicatePct: 2,             // customers who double-click Buy and Pay (same Idempotency-Key)
  paymentSuccessPct: 95,
  lostResponsePct: 3,            // PSP charged but the response never arrived (timeout)
  abandonPct: 3,                 // reserved but never paid -> TTL expiry
  reservationTtlMs: 2500,        // ~5 min in production
  paymentTimeoutMs: 600,
  paymentMethod: 'card',
  rateLimit: { capacity: 2500, refillPerSec: 3000 },
  dbLatency: { min: 1, max: 4 },
  lb: { podsPerZone: 2 },        // API gateway pods per availability zone (3 zones)
  orderOutage: { enabled: true, startMs: 400, durationMs: 3000 },     // "Order Service down for 30 s"
  gatewayOutage: { enabled: false, startMs: 2500, durationMs: 1500 },   // optional extra scenario
  podFailure: { enabled: false, startMs: 600, durationMs: 2000, podId: 'gw-a1' },   // one gateway pod dies
};

export function mergeConfig(input = {}) {
  const c = structuredClone(DEFAULT_CONFIG);
  for (const [k, v] of Object.entries(input)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && c[k]) Object.assign(c[k], v);
    else if (v !== undefined) c[k] = v;
  }
  c.users = Math.min(Math.max(1, Number(c.users)), 50000);
  c.stock = Math.min(Math.max(1, Number(c.stock)), 1000);
  c.botPct = Math.min(Math.max(0, Number(c.botPct) || 0), 100);
  c.lb.podsPerZone = Math.min(Math.max(1, Number(c.lb.podsPerZone) || 1), 4);
  return c;
}
