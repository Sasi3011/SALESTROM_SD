# 01. Requirements & Assumptions

## 1. Problem statement

SALESTORM runs a limited-stock flash sale. At sale open, **10,000 customers press "Buy now" at the same moment for 100 units of Product X**. The platform must:

1. never sell more units than exist,
2. never charge a customer twice or lose a paid order,
3. stay responsive while traffic spikes up to 50× normal, and
4. give every customer a definite answer (bought, sold out, payment failed, try again).

The business question this design answers: *How can we handle thousands of simultaneous purchase requests for limited inventory without overselling, while keeping payment and order processing reliable?*

## 2. Actors

| Actor | Description |
|---|---|
| Customer | Browses, reserves, pays, tracks delivery. Authenticated for reserve/pay. |
| Sale administrator | Creates sales, sets stock, start/end time, per-customer limit. |
| Payment service provider (PSP) | External gateway (e.g. Razorpay/Stripe-style). Supports idempotency keys and status lookup. |
| Courier partner | External delivery API. |
| SMS / email provider | External notification channel. |
| Operations engineer | Watches dashboards, handles alerts and dead-letter queues. |

## 3. Functional requirements

| ID | Requirement | Pipeline stage |
|---|---|---|
| FR-01 | Browse products and sale details; show sale status and approximate stock ("Few left", "Sold out"). | Product discovery |
| FR-02 | Add sale item to cart (limit 1 unit per customer per sale, configurable). | Cart |
| FR-03 | Check availability before reserving. Reject immediately when sold out. | Inventory check |
| FR-04 | Create a **temporary reservation** that holds one unit for a fixed TTL (default 5 min). | Inventory reservation |
| FR-05 | Treat repeated "Buy now" requests with the same `Idempotency-Key` as one request. | Inventory reservation |
| FR-06 | Release a reservation automatically when it expires unpaid, or when payment fails. | Inventory reservation |
| FR-07 | Start checkout only for a live, unexpired reservation owned by the caller. | Checkout |
| FR-08 | Charge the customer through a PSP exactly once per reservation, even with retries, double-clicks or timeouts. | Payment |
| FR-09 | Resolve uncertain payments (timeouts) by querying the PSP, never by guessing. | Payment |
| FR-10 | Create and confirm an order for every successful payment, even if the Order Service was down at the time of payment. | Order |
| FR-11 | Track order lifecycle CREATED → PAYMENT_PENDING → CONFIRMED → PROCESSING → SHIPPED → OUT_FOR_DELIVERY → DELIVERED, plus CANCELLED. | Order |
| FR-12 | Hand confirmed orders to fulfilment and create shipments with a courier partner. | Fulfilment, Shipment |
| FR-13 | Notify customers on order confirmed, payment failed, reservation expired, shipment updates. | Notification |
| FR-14 | Let customers track delivery status. | Delivery tracking |
| FR-15 | Let administrators configure sales, stock and limits, and view live sale metrics. | Admin |

## 4. Non-functional requirements (measurable)

| ID | Quality | Target | Notes |
|---|---|---|---|
| NFR-01 | Throughput (edge) | 10,000 req/s normal; **500,000 req/s** flash-sale peak at CDN/edge | Most of it is product page and static traffic served by CDN. |
| NFR-02 | Throughput (buy API) | 100,000 req/s at API gateway; admit ≤ 20,000 req/s to Sale/Inventory | Rate limiting + waiting room protect the core. |
| NFR-03 | Latency | Reserve p99 ≤ 200 ms server-side; sold-out rejection p99 ≤ 50 ms | Sold-out answers come from Redis, not the database. |
| NFR-04 | Latency | Pay p99 ≤ 3 s (PSP-bound); order confirmed p95 ≤ 5 s after payment, ≤ 60 s during an Order Service outage | |
| NFR-05 | Availability | Buy path 99.95 % during sale window; payment path 99.9 % | Payment depends on an external PSP. |
| NFR-06 | Consistency | **Strong** for stock counters, reservations, payments. **Eventual** (≤ 60 s) for order status, notifications, displayed stock | See guarantees table. |
| NFR-07 | Durability / recovery | RPO = 0 for inventory, payments, orders (synchronous replica). RTO ≤ 60 s for database failover | |
| NFR-08 | Scalability | Every stateless service scales horizontally; downstream load bounded by stock, not by traffic | Key design property. |
| NFR-09 | Security | OAuth 2.0 / OIDC, TLS 1.2+ everywhere, PCI-DSS scope minimised by PSP tokenisation, per-user and per-IP rate limits, bot protection | |
| NFR-10 | Observability | Every purchase traceable end to end with one trace ID; alerts within 1 min on inventory inconsistency, payment failure spikes, queue backlog | |

## 5. Strict guarantees vs targets

The brief asks which requirements are hard guarantees and which are targets. This distinction drives every design decision.

| Strict guarantees (must never break) | Targets (best effort, monitored) |
|---|---|
| Units sold ≤ units in stock | Latency percentiles |
| `available + reserved + sold = stock` at every committed state | Exact fairness (first-click wins) |
| One reservation per idempotency key and per customer per sale | Order confirmation delay |
| At most one charge per reservation | Notification delivery time |
| Every captured payment eventually has exactly one confirmed order, or is refunded | Displayed stock accuracy on product page |
| No reservation stays held forever | All 100 units sold (some may expire unsold near sale end) |

## 6. Assumptions

1. One SKU (Product X) per flash sale for the core scenario; design generalises to many SKUs (one inventory row per SKU per sale).
2. Limit of **1 unit per customer per sale**; quantity is still modelled for future multi-unit sales.
3. Customers are logged in before the sale opens (login is not on the hot path).
4. Reservation TTL is 5 minutes; a payment once started is not expired by the TTL sweeper.
5. PSP supports idempotency keys and a status-lookup API; PSP declines are final for that attempt.
6. Payment success rate ≈ 95 %; ≈ 2 % of requests are duplicates (double clicks, client retries).
7. Card data never touches SALESTORM servers (PSP hosted fields / tokenisation).
8. Deployment on a managed Kubernetes cluster across 3 availability zones in one region.
9. Fairness model: first request to commit at the database wins; we do not promise strict arrival order across the edge.

## 7. Constraints

* Inventory for one SKU lives in **one row**, which makes it a natural hot spot (see ADR-002).
* The PSP is outside our control: it can be slow, return timeouts or be unavailable.
* Hackathon scope: design first; prototype is in `11_AI_Assisted_Validation/prototype`.

## 8. Expected traffic model

| Phase | Customers | Requests | Comment |
|---|---|---|---|
| Pre-sale (T−10 min) | 50,000 browsing | ~10,000 req/s | Product page served by CDN; sale page polls status |
| Sale open (T+0 to T+5 s) | 10,000 click Buy now | ~10,000 reserve calls + retries + duplicates ≈ 12,000 | Burst. Gate rejects ≈ 99 % in memory |
| Checkout (T+5 s to T+5 min) | ≤ 100 holders | ~100 pay calls | Bounded by stock |
| Post-sale | 100 orders | Fulfilment, notifications, tracking | Async |

**Key insight:** traffic scales with customers, but everything after the inventory gate scales with **stock**. A 50× traffic spike changes the edge, gateway and gate; it barely changes the database, payment or order load.

## 9. Critical dependencies

| Dependency | Failure impact | Mitigation |
|---|---|---|
| PostgreSQL (inventory) | Cannot reserve | Synchronous standby, automatic failover, 503 + Retry-After during failover |
| Redis | Gate, idempotency cache, rate limit unavailable | Fail open to DB with reduced admission rate; DB guard remains correct |
| Kafka | Events delayed | Transactional outbox keeps events in DB until Kafka recovers |
| PSP | Cannot take payments | Circuit breaker, reservation hold extension, reconciliation, optional secondary PSP for new attempts |
| Order Service | Orders not confirmed yet | Events wait in Kafka; retries with backoff; DLQ + replay |
