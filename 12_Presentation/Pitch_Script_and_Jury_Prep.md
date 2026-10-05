# 12. Final Pitch (5 minutes) & Jury Preparation

**Slides:** [`SALESTORM_NullPointer_Pitch.pptx`](SALESTORM_NullPointer_Pitch.pptx) (PDF copy: [`SALESTORM_NullPointer_Pitch.pdf`](SALESTORM_NullPointer_Pitch.pdf)). Slides 2–8 follow the timing below, and each shows its time slot in the top-right corner. Each slide's speaker notes contain the lines to say. Slide 9 is the final jury question, with all 12 steps in its notes.

Suggested speaker split for a team of 3: **A** = System Architect, **B** = LLD & Data, **C** = Reliability. (Team of 4: give section 6 to the fourth member.)

## Pitch script, timed to the brief

| Time | Speaker | Say this | Show this |
|---|---|---|---|
| 0:00–0:30 | A | "10,000 people press Buy at the same second for 100 units. If two of them both get the last unit, we either cancel a paid order or ship something we don't have. Our job: every transaction correct, under any load, through any failure." | Title + unit grid screenshot |
| 0:30–1:00 | A | "Five guarantees we never break: never sell more than stock; stock always adds up; one reservation per request; one charge per reservation; every payment ends in an order or a refund. Latency and fairness are targets, not guarantees." | `01_Requirements` guarantees table |
| 1:00–2:00 | A | "Traffic goes CDN, gateway, Redis gate, then the database. The gate answers 'sold out' from memory for 99 % of people. Decisions are synchronous; consequences are asynchronous through Kafka with a transactional outbox. Each service owns its own data." | HLD diagram |
| 2:00–3:00 | B | "The exact point where overselling is prevented is one SQL statement: `UPDATE … SET available = available − 1 WHERE available >= 1`. We tested four approaches. Naive sold 2,000 of 100. Pessimistic was correct but took 4.5 seconds. Optimistic was correct but sold only 42 units because customers gave up. Atomic update: exactly 100, 8 ms, and with the gate only 100 database calls." **Live: press Start flash sale.** | Concurrency Lab chart, then Live sale |
| 3:00–3:45 | C | "Payment uses one key per reservation, at our database and at the gateway, so double clicks and timeouts can't double charge. A timeout is UNKNOWN, never guessed; we ask the gateway. If the Order Service is down after payment, the event waits in Kafka and the order confirms when it recovers. You can see it here." | Tracer: *Paid, then Order Service down* |
| 3:45–4:30 | B | "Inventory service: a Strategy interface for concurrency control, Factory to choose it, State machine for the reservation lifecycle, Repository for the SQL. Adding a payment provider is one adapter class and one registry line." | Class diagram + state diagram |
| 4:30–5:00 | C | "At 50× traffic only the edge and gate change; the database still sees about a hundred writes, because load after the gate is bounded by stock. Our prototype, built with AI assistance and validated by 15 tests and live invariants, shows all eight guarantees holding, even with a gateway pod killed mid-sale." | Invariants panel all green |

## The final jury question — rehearse this answer word for word

> *"100 units remaining, 10,000 customers clicking Buy now. Walk us through exactly what happens from request arrival until the final valid orders are confirmed."*

1. **Edge.** CDN/WAF filters bots. If admission exceeds capacity, the waiting room hands out signed queue tokens.
2. **Gateway.** JWT verified, request validated, token bucket applied. Excess requests get 429 with Retry-After; they retry with the same idempotency key.
3. **Idempotency.** Double clicks with the same key collapse into the first request.
4. **Per-customer limit.** A partial unique index allows one active hold per customer.
5. **Redis gate.** A Lua script decrements a token if one is left. The first ~100 get through. Everyone else gets 409 SOLD_OUT from memory in about a millisecond; the database never sees them.
6. **Database guard — the consistency point.** In one transaction: `UPDATE inventory SET available = available − 1, reserved = reserved + 1 WHERE available >= 1`, insert the reservation (RESERVED, expires in 5 min), insert an outbox event, commit. Two requests for the last unit serialise on the row lock; the second re-checks the guard, sees 0, updates 0 rows, and gets SOLD_OUT. Its gate token is returned.
7. **Response.** 201 with reservation ID and expiry.
8. **Pay.** Checkout moves the hold to PAYMENT_PENDING only if it hasn't expired, emits CheckoutStarted, and calls the PSP through a circuit breaker with key `pay_{reservationId}`.
9. **Outcomes.** Success → payment row + PaymentSucceeded committed together. Decline → PaymentFailed. Timeout → UNKNOWN, resolved by the reconciler asking the PSP.
10. **Async.** Inventory consumes PaymentSucceeded → CONFIRMED (reserved −1, sold +1); PaymentFailed → RELEASED (available +1, token +1, someone else can buy it). Unpaid holds expire after 5 minutes and are released the same way.
11. **Orders.** Order service consumes in order per reservation → CONFIRMED → OrderConfirmed → fulfilment, notification, reservation SOLD. If it's down, events wait and are retried; nothing is lost.
12. **End state.** Sold ≤ 100, available + reserved + sold = 100, every captured payment has exactly one confirmed order. Our dashboard checks these live.

## Likely jury questions

| Question | Short answer | Point to |
|---|---|---|
| Why is this the correct service boundary? | Boundaries are consistency boundaries. Stock and reservations change in one transaction, so one service; money in another; orders in another. | ADR-001 |
| Where exactly is inventory consistency guaranteed? | In the inventory database: the conditional UPDATE guard plus `CHECK (available >= 0)`. Nowhere else; Redis is only a filter. | HLD §4 |
| Two requests reach inventory at the same time? | Row lock serialises them; second re-evaluates `WHERE available >= 1` on the committed value; 0 rows → SOLD_OUT. Tested 50× in a loop. | Seq. 03.2 |
| Why this concurrency strategy? | Measured: only option that is correct, fast, and sells every unit. Optimistic under-sells on a hot row; pessimistic is slow. | ADR-002, Lab |
| What if Redis says yes but DB says no? | Fine: DB rejects, token returned. Redis can only let extra requests through, never cause oversell. | ADR-002 |
| What if Redis is down? | Fail open: bypass gate, tighten rate limit. Correctness unchanged. | ADR-009 |
| Why is reserve synchronous but order creation asynchronous? | Customer needs the reserve decision now; order is a consequence of an already-recorded payment. Sync order creation would let an Order outage block payments. | ADR-004 |
| Payment succeeded, Order Service fails? | Outbox guarantees the event exists; Kafka retains it; consumer retries with backoff; DLQ + replay; reconciler alerts on paid-without-order; refund if unfulfillable. | Seq. 03.4, tracer |
| How do you avoid double charging on timeout? | Never retry blindly. Status UNKNOWN → ask PSP by idempotency key → record result; retry with the same key only if PSP has no record. | Seq. 03.3 |
| What if the customer pays one second after the hold expires? | Can't happen: starting payment requires `expires_at > now()`, and the sweeper never expires PAYMENT_PENDING. | ADR-006 |
| Likely bottleneck? | Gateway and gate during the burst (scale horizontally, waiting room, shard gate). The DB row only for huge stock (bucketed rows). | Scalability §3 |
| What changes at 50×? | Edge, waiting room, gateway pods, possibly gate sharding. DB, payment, order load unchanged: bounded by stock. | Scalability §3 |
| Database fails mid-sale? | Sync standby promoted in < 30 s; 503 + Retry-After; idempotent retries; re-sync gate from DB. RPO 0. | Scalability §5 |
| What does your design sacrifice? | Multi-region inventory writes, instant order confirmation, perfect arrival-order fairness, monolith simplicity. | ADR summary |
| How did you validate AI-generated code? | 15 tests including one that must fail (naive oversells), live invariant checker, trace review against sequence diagrams, failure variants. | Validation report |
| Is it fair? | First commit at the database wins. Waiting room gives FIFO admission at the edge; we don't promise strict global order. | Requirements §6 |
