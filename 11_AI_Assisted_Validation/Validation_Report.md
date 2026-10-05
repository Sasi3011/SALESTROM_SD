# 11. AI-Assisted Validation — Report

The prototype exists to **test design assumptions**, not to be the product. Each experiment below is linked to the design decision it validates.

## How to reproduce

```bash
cd prototype/backend && npm install && npm test          # 11 automated checks
cd ../frontend && npm install && npm run build           # build the dashboard
cd ../backend && npm start                               # open http://localhost:4000
```

## Experiment 1 — Which concurrency control prevents overselling? (validates ADR-002)

Concurrency Lab, 2,000 simultaneous buyers on one row with 100 units, DB latency 1–4 ms:

| Strategy | Reserved | Oversold | Version conflicts | Gave up | DB calls | p99 |
|---|---|---|---|---|---|---|
| naive | 2,000 | **1,900** | 0 | 0 | 4,000 | ~41 ms |
| pessimistic | 100 | 0 | 0 | 0 | 2,100 | **~4,450 ms** |
| optimistic | **~43** | 0 | ~13,900 | ~1,957 | ~27,800 | ~140 ms |
| atomic | 100 | 0 | 0 | 0 | 2,000 | ~7 ms |
| atomic + Redis gate | 100 | 0 | 0 | 0 | **100** | ~3 ms |

Conclusion: only the atomic conditional update is correct **and** fast **and** sells every unit. The gate reduces DB load to the size of the stock.

## Experiment 2 — The brief's practical test case (validates the whole design)

Defaults: 10,000 customers, 100 units, 95 % payment success, 2 % duplicates, 3 % lost PSP responses, 3 % abandon after reserving, Order Service down for 3,000 ms (= 30 s at 10× compression), atomic strategy + gate. Representative run:

| Measure | Result |
|---|---|
| HTTP requests (incl. retries and duplicates) | ~11,500 |
| Throttled with 429 and retried | ~1,100–1,500 |
| Rejected at Redis gate (DB untouched) | ~9,900 |
| Requests reaching inventory DB | **~108** (100 + re-sales of released units) |
| Units sold | **100 / 100** |
| Payments declined → unit released and resold | 5–8 |
| Holds expired (abandoned) → released and resold | ~3 |
| PSP timeouts → reconciled, no second charge | 2–5 |
| Events queued during Order Service outage | ~220 at peak, all delivered |
| Orders confirmed | 100 (= payments captured) |
| Correctness guarantees | **7 / 7 held** |

## Experiment 3 — Failure variants

| Variant | Result | Design insight |
|---|---|---|
| Payment gateway down 1.5 s | Circuit opened, 237 calls failed fast, 0 double charges, 95 sold, **89 holds expired** | Add TTL extension while circuit is open (ADR-006 follow-up) |
| Naive strategy, gate off | **1,136 sold of 100**, `reserved` counter driven to −977 | Confirms the bug the design prevents; invariants detect it |
| Optimistic strategy, gate off | Correct, but 740 customers got "contention" errors | Confirms ADR-002 rejection of optimistic for hot rows |

## Experiment 4 — Automated tests (`npm test`)

| Test | Validates |
|---|---|
| atomic: 2,000 buyers, 100 units → exactly 100 | No oversell |
| last unit: 2 buyers, 1 unit → exactly 1 wins (×50) | Brief's "last item" requirement |
| pessimistic correct | Comparison baseline |
| optimistic never oversells | Comparison baseline |
| naive oversells | Proves the test can detect the bug |
| 50 concurrent duplicate Buy → 1 reservation | Idempotency |
| one customer, two keys → 1 reservation | Per-customer limit |
| triple Pay → one charge, one order | Payment idempotency |
| failed payment releases unit | Failure path |
| unpaid hold expires and releases | TTL path |
| scaled practical test case with outage → all invariants pass | End-to-end |

Result: **11 passed, 0 failed**.

## Limits of this evidence (stated honestly)

* The database, Redis and Kafka are **simulated in-process**. Node.js runs one thread, so atomicity of the "atomic" methods comes from the event loop; in production it comes from PostgreSQL row locks. The simulation reproduces the *interleavings* (via injected latency) that cause lost updates, which is what the comparison needs.
* Timings are relative, not absolute: they show order-of-magnitude differences, not production latency.
* A production-grade validation would repeat Experiment 1 against real PostgreSQL with JMeter/Locust (`UPDATE … WHERE available >= 1`), which we list as next step.
