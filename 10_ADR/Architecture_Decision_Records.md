# 10. Architecture Decision Records

Format: Context → Options → Decision → Consequences (what we gain, what we sacrifice). Status of all records: **Accepted** (5 Oct 2026).

---

## ADR-001 — Service boundaries: domain microservices with a dedicated Inventory & Reservation service

**Context.** The flash sale stresses one capability (stock) far more than others, and stock must be strongly consistent while orders, notifications and fulfilment can lag.

**Options.**
1. Modular monolith with one database.
2. Domain microservices, database per service.
3. Fine-grained microservices (separate reservation, stock, expiry services).

**Decision.** Option 2. Boundaries follow data ownership: Catalog, Cart, Sale, **Inventory & Reservation**, Checkout (stateless facade), Payment, Order, Fulfilment, Notification.

**Why this is the correct boundary.** Reservation and stock counters change together in one transaction, so they live in one service and one database (splitting them, option 3, would need a distributed transaction for every Buy). Payment owns money and the PSP relationship; Order owns lifecycle history. Each boundary is a consistency boundary.

**Consequences.** + Inventory can be scaled, tuned and deployed independently; a PSP outage cannot corrupt stock. − Cross-service flows need events, idempotency and reconciliation; more operational components. A modular monolith would be simpler for a small team; we accept the complexity because the sale's load profile is extremely uneven across domains.

---

## ADR-002 — Concurrency control: atomic conditional UPDATE in PostgreSQL, fronted by a Redis admission gate

**Context.** 10,000 concurrent requests target one inventory row with 100 units. Requirement: never oversell; answer fast; sell all units if customers pay.

**Options compared (measured in the prototype Concurrency Lab, 2,000 simultaneous buyers, 100 units, no gate unless stated):**

| Option | Reserved | Oversold | DB calls | p99 | Verdict |
|---|---|---|---|---|---|
| A. Read, check in code, write | 2,000 | **1,900** | 4,000 | ~40 ms | Wrong: lost updates |
| B. Pessimistic `SELECT … FOR UPDATE` | 100 | 0 | 2,100 | **~4,500 ms** | Correct, but every request queues on the lock across 2 round trips |
| C. Optimistic version column + retry | **~42** | 0 | **~27,800** | ~150 ms | Correct, but under a stampede most writers lose; customers give up while units stay unsold |
| D. **Atomic conditional UPDATE** (`WHERE available >= 1`) | 100 | 0 | 2,000 | ~8 ms | Correct, one round trip, no retries |
| D + **Redis gate** | 100 | 0 | **100** | ~3 ms | Correct, DB load bounded by stock |
| E. Redis-only counter (no DB guard) | 100 | 0 | 0 | ~1 ms | Fast, but Redis is not our durable source of truth; failover can lose acknowledged writes |
| F. Single-consumer queue per SKU (serialise all buys) | 100 | 0 | 100 | Queue-bound | Correct, but adds async response handling for a decision the DB makes in microseconds |

**Decision.** D + gate. The database is the single source of truth; the guard in the `WHERE` clause and the `CHECK (available >= 0)` constraint make overselling impossible regardless of what happens above. The Redis Lua gate sheds ~99 % of load; it can only err toward letting extra requests through to the DB, never toward overselling.

**Consequences.** + Deterministic last-unit outcome, minimal DB load, simple to explain. − Two systems hold a stock number (Redis, DB) → drift possible; mitigated by returning tokens on DB rejection/release and a periodic re-sync (`tokens = available`). − One hot row limits very large sales → bucketed rows strategy planned (plugs in via Strategy pattern).

---

## ADR-003 — SQL (PostgreSQL) for inventory, payments and orders; Redis for ephemeral state

**Options.** Relational (PostgreSQL); document store (MongoDB); wide-column (Cassandra); Redis only.

**Decision.** PostgreSQL for all money and stock data; Redis for gate tokens, idempotency cache, rate limits, carts, and catalog cache.

**Why.** We need multi-row ACID transactions (stock update + reservation insert + outbox), CHECK and UNIQUE constraints that enforce invariants in the database itself, and row-level locking semantics that re-check guards. Cassandra's lightweight transactions and MongoDB's document transactions could work, but give fewer built-in guarantees and are less familiar to operate for this pattern.

**Consequences.** + Invariants enforced by the engine, not just by code. − Vertical write scaling per database; mitigated by database-per-service and by the gate keeping write volume tiny. NoSQL would scale writes further but we do not need it: writes are bounded by stock.

---

## ADR-004 — Synchronous for decisions, asynchronous for consequences

**Decision.** Reserve and Pay are synchronous (customer waits for an answer). Everything after a payment result (inventory confirm/release, order creation and confirmation, fulfilment, notifications) is asynchronous via Kafka.

**Why is reservation sync but order creation async?** Reservation is a decision the customer must see now and the DB makes it in milliseconds. Order confirmation is a consequence of a payment that is already durably recorded; making it synchronous would mean an Order Service outage fails or blocks payments — exactly the brief's failure scenario.

**Consequences.** + Order Service, courier or SMS outages never block checkout; brief scenario "payment succeeds, Order Service fails" is handled by design. − Eventual consistency: for a few seconds a customer can be PAID while the order is PAYMENT_PENDING. The UI says "Payment received, confirming your order" and polls.

---

## ADR-005 — Transactional outbox instead of publishing directly to Kafka

**Context.** Writing to the DB and then publishing to Kafka are two separate writes. A crash in between either loses the event (paid, no order) or publishes an event for a rolled-back change.

**Decision.** Insert the event into an `outbox` table in the same transaction as the state change; a relay (Debezium CDC) publishes it to Kafka. Consumers are idempotent (at-least-once delivery).

**Consequences.** + No dual-write gap; events survive Kafka outages. − Extra table and relay; small publish delay; consumers must de-duplicate.

---

## ADR-006 — Reservation with TTL; PAYMENT_PENDING is never expired by the sweeper

**Decision.** Holds expire after 5 minutes (configurable). A scheduled sweeper (`FOR UPDATE SKIP LOCKED`, safe to run on many pods) moves only `RESERVED` holds to `TIMEOUT → RELEASED`. Starting payment is a conditional update that requires `expires_at > now()`. Once `PAYMENT_PENDING`, the hold is resolved only by a payment result (or reconciliation).

**Why.** Removes the race "customer paid at 5:00.5, sweeper released at 5:00.4, unit resold → oversell or forced refund".

**Consequences.** + No paid-but-released units. − A payment stuck UNKNOWN keeps a unit held until reconciliation resolves it (bounded by reconciler interval + PSP status API). − During a PSP outage customers may lose holds; **follow-up:** extend TTL while the payment circuit is open (found by prototype gateway-outage run: 89 holds expired, 5 units unsold).

---

## ADR-007 — Idempotency at three layers

**Decision.** (1) HTTP `Idempotency-Key` on reserve and pay, stored in Redis (in-flight + result, 24 h) with `UNIQUE` DB columns as backstop. (2) Payment idempotency key = `pay_{reservationId}`, unique in our DB and sent to the PSP. (3) Event consumers check state/`processed_event` before acting.

**Consequences.** + Double-clicks, client retries, timeouts and redelivered events cannot duplicate reservations, charges or orders (validated: 0 double charges across all runs; 50 concurrent identical requests → 1 reservation). − Key storage and an extra lookup per write request; clients must generate and reuse keys correctly.

---

## ADR-008 — Caching strategy

| Data | Strategy | Staleness allowed |
|---|---|---|
| Product pages, images | CDN, 60 s TTL, purge on edit | 60 s |
| Product details (API) | Redis cache-aside, 5 min TTL | 5 min |
| Sale stock badge | Derived from gate tokens, cached 1 s | 1 s (display only) |
| **Authoritative stock** | **Never cached**; decision always at DB guard | 0 |
| Idempotency results | Redis, 24 h | n/a |

**Consequences.** + Product page traffic never touches the origin DB. − Product page may show "Few left" for up to a second after sell-out; the Buy decision is still exact.

---

## ADR-009 — Fail-open for the Redis gate, fail-closed for payments

**Decision.** If Redis is unavailable, the gate is bypassed (requests go to the DB guard) and the gateway rate limit is tightened. If the PSP is unhealthy, payments fail fast (circuit open) and are never "assumed successful".

**Why.** The gate is an optimisation; correctness lives in the DB. Payment correctness lives outside us, so uncertainty must stop, not proceed.

**Consequences.** + Redis outage degrades latency, not correctness. − DB sees more load during a Redis outage (bounded by tightened rate limit).

---

## Summary of what this architecture sacrifices

| We chose | We gave up |
|---|---|
| Strong consistency for stock (CP at the inventory row) | Multi-region active-active writes for inventory |
| Async order confirmation | Instant "Order confirmed" in the same response |
| Database guard as source of truth | Absolute minimum latency of a Redis-only design |
| Microservices with events | Simplicity of a single-database monolith |
| Strict first-commit-wins | Perfect arrival-order fairness across the edge |
