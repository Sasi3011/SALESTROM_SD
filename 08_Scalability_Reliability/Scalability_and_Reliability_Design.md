# 08. Scalability & Reliability Design

## 1. Challenge A: 10,000 customers, 100 units, step by step

| Step | Where | What happens to the 10,000 | Mechanism |
|---|---|---|---|
| 1 | CDN / WAF | Bots and abusive IPs dropped; page assets served from edge | Bot scoring, IP reputation, edge rate limit |
| 2 | Waiting room (only when admission > capacity) | Users get a queue token and are admitted at a fixed rate | Signed queue token checked by gateway |
| 3 | Load balancer | Spread across gateway pods in 3 AZs | L7 least-request |
| 4 | API gateway | JWT checked; per-user (5/s), per-IP, and global token bucket. Excess → **429 + Retry-After** (throttled, not lost) | Token bucket in Redis |
| 5 | Idempotency guard | Duplicate clicks collapse into the first request | `SET NX` + `UNIQUE(idempotency_key)` |
| 6 | **Redis stock gate** | First ≈ 100 requests take a token. All others get `409 SOLD_OUT` **in memory** | Lua decrement-if-enough |
| 7 | **Inventory DB** | ≈ 100 requests (+ re-sales of released units) run one conditional `UPDATE`. **Contention is controlled here** | Row lock + guard |
| 8 | Checkout → Payment | ≤ 100 payments, bounded by stock | Circuit breaker, idempotency |
| 9 | Kafka → Order, Fulfilment, Notification | ≤ 100 orders | Outbox, ordered partitions |

**Measured in the prototype (default brief scenario):** 10,000 customers produced ~11,500 HTTP requests (retries + duplicates). ~1,100–1,500 were throttled with 429 and retried; ~9,900 sold-out answers came from the gate; only **~108 requests reached the inventory database**; exactly 100 units sold; every invariant held. Without the gate and with the atomic strategy, the database takes one call per request (2,000 calls for 2,000 users in the lab) and is still correct.

## 2. Horizontal scaling and state

| Tier | Stateless? | Scaling approach |
|---|---|---|
| Gateway, Checkout, Catalog, Cart, Sale, Order, Payment, Notification | Yes | Kubernetes HPA; **pre-scaled 30 min before sale** (`minReplicas` raised by a scheduled job) because autoscaling reacts in minutes and the burst lasts seconds |
| Inventory service | Yes (state in DB/Redis) | Pods scale freely; correctness is in the DB, not in pod memory, so any pod can serve any request |
| Redis | Stateful, ephemeral | Cluster shards; gate key per SKU; can be rebuilt from DB (`tokens = available_quantity`) |
| PostgreSQL | Stateful, durable | Database per service; vertical scale + read replicas for reads; inventory writes stay on the primary |
| Kafka | Stateful, durable | Partitions keyed by `reservationId`; more partitions → more consumer pods |

**No sticky sessions.** Any request can land on any pod. All session-like state (cart, idempotency, rate limits) is in Redis; all business state is in PostgreSQL.

## 3. What changes at 50× traffic (10k → 500k req/s)

The central property: **load after the gate is bounded by stock, not by traffic.**

| Layer | At 10k req/s | At 500k req/s | Change needed |
|---|---|---|---|
| CDN / WAF | Easy | Primary shield | More edge capacity; aggressive caching of product/sale pages (sale status cached 1 s) |
| Waiting room | Usually idle | **Active**: admits e.g. 20k users/s | Turn on; issue signed queue tokens |
| API gateway | ~10 pods | ~60–100 pods | Pre-scale; JWKS cached; cheap 429s |
| Redis gate | One key, ~10k ops/s | Admission-limited to ~20k ops/s; peak single-shard capacity ~100k ops/s | If admission must exceed one shard: **split stock into N bucket keys** (e.g. 10 × 10 units), client hashed to a bucket, fallback scan when its bucket is empty |
| Inventory DB | ~110 writes | ~110 writes | **No change.** Same stock, same writes |
| Payment / PSP | ≤ 100 calls | ≤ 100 calls | No change |
| Kafka / Order | ≤ 100 orders | ≤ 100 orders | No change |
| Observability | Normal | High-cardinality spike | Sample traces for rejected requests (1 %), keep 100 % for reservations and payments |

For a much larger sale (say 100,000 units), the inventory row becomes the bottleneck. Then: **bucketed inventory rows** (N rows per SKU, each with a slice of stock; reservation picks a random bucket; sum of buckets = stock) so N row locks work in parallel. This is a new `ReservationStrategy`, no change to the service (OCP).

## 4. Reliability mechanisms

| Mechanism | Where | Setting |
|---|---|---|
| Timeouts | Every outbound call | Inventory 300 ms; PSP 3 s; courier 5 s. No call without a timeout |
| Retries | Clients (reserve/pay) and consumers | Exponential backoff with jitter; max 3 for sync calls; **only idempotent operations are retried**; never retry 409/402 |
| Circuit breaker | PSP, courier, SMS adapters | Open after 5 consecutive infrastructure failures (timeouts, 5xx); 30 s open; 1 trial call in HALF_OPEN; declines don't count |
| Bulkheads | Separate connection pools / thread pools for PSP calls vs DB | A slow PSP cannot exhaust DB connections |
| Dead-letter queues | Every Kafka consumer group | After 25 attempts → `*.dlq`; alert; replay job after fix |
| Idempotent consumers | All event handlers | State guard + `processed_event` table |
| Outbox | Inventory, Payment, Order databases | Removes dual writes |
| Reconciliation jobs | Payment (UNKNOWN), Order (paid without order), Redis gate (tokens vs DB) | Every 30–60 s; alerts on any mismatch |
| Graceful degradation | Product page shows cached stock badge; notifications can lag; recommendations off during sale | Protect the purchase path first |

## 5. Failure scenarios and recovery

| Failure | Detection | Customer impact | Recovery | Data safety |
|---|---|---|---|---|
| **Order Service down 30 s** (brief test case) | Consumer errors, lag alert | Sees "Payment received, confirming your order"; confirmation delayed | Kafka holds events; consumer retries with backoff; resumes on recovery; DLQ replay if retries exhausted | No loss (prototype: 100/100 orders confirmed after a 3 s compressed outage) |
| **PSP timeout** | Timeout on call | "Payment processing" (202) | Payment UNKNOWN → reconciler queries PSP by idempotency key → finalise or retry with same key | No double charge (key at our DB + PSP) |
| **PSP down** | Breaker opens | 503 "try again"; hold kept | Breaker half-opens to probe; **improvement identified in testing:** extend `expires_at` of RESERVED holds by the outage duration while breaker is OPEN, so customers don't lose units they were about to pay for. Optional secondary PSP for *new* attempts only | No charge happens while open |
| **Inventory DB primary fails** | Patroni health check | Reserve returns 503 + Retry-After for ≤ 30 s | Sync standby promoted; clients retry with same key; Redis gate re-synced from DB (`tokens = available`) | RPO 0 (synchronous replica); idempotency prevents double holds on retry |
| **Redis fails** | Error rate on gate | Slightly slower sold-out answers | **Fail open**: skip gate, tighten gateway rate limit; DB guard keeps correctness. Rebuild gate from DB when Redis returns | No correctness impact (gate is an optimisation) |
| **Kafka broker fails** | Broker metrics | None | RF=3, `min.insync.replicas=2`; outbox rows stay unpublished until relay can publish | Events kept in DB outbox |
| **Inventory pod crashes mid-request** | Request error | Client retries with same key | Transaction rolled back (nothing committed) or committed (idempotency replays result) | Atomic transaction |
| **Sweeper crashes** | Heartbeat metric | Holds expire later than 5 min | Kubernetes restarts; multiple sweepers safe because of `SKIP LOCKED` | No double release (state guard) |
| **Whole AZ lost** | Multi-AZ health | Brief errors | Pods rescheduled in other AZs; DB standby in other AZ | RPO 0 |

## 6. Capacity estimate (planning numbers)

| Item | Estimate |
|---|---|
| Gateway pod | ~2,000 req/s (TLS terminated at LB) → 60 pods for 100k req/s plus 20 % headroom |
| Redis single shard | 100k+ simple ops/s; Lua gate ~50–80k/s |
| PostgreSQL conditional update on one row | ~2–5k/s serialised (lock held for microseconds); actual load ~110 per sale |
| PSP | ≤ 100 charges per sale; within any PSP rate limit |
| Kafka | Thousands of events per second per partition; ~600 events per sale |
