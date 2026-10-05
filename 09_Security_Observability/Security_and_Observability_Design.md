# 09. Security & Observability Design

## Part A — Security

### A1. Controls by requirement

| Requirement | Control | Where |
|---|---|---|
| Authentication | OAuth 2.0 / OIDC; short-lived access JWT (15 min) + refresh token; gateway validates signature, `exp`, `aud`, `iss` with cached JWKS | API gateway |
| Authorization | Customer ID always taken from token `sub`. Ownership checks on every reservation, payment and order read/write (`reservation.customer_id = sub`). Admin APIs need `role=admin` + MFA | Gateway (coarse), services (fine-grained) |
| Service-to-service | mTLS via service mesh; network policies deny by default; each service has its own DB credentials limited to its own schema | Mesh, Kubernetes |
| HTTPS | TLS 1.2+ at CDN and LB; HSTS; TLS re-established inside mesh (mTLS) | Edge, mesh |
| Rate limiting & abuse | WAF bot scoring, per-IP and per-user token buckets, per-customer purchase limit (1 unit, DB-enforced), waiting-room tokens signed with HMAC, CAPTCHA challenge for suspicious sessions | Edge, gateway, DB |
| Input validation | JSON schema at gateway; strict types; `quantity` must be 1; IDs must be UUIDs; reject unknown fields; parameterised SQL only | Gateway, repositories |
| Payment data | Card data never reaches SALESTORM: PSP hosted fields/SDK return a token. We store only `provider_txn_id`, last 4 digits and status → minimal PCI-DSS scope (SAQ-A style) | Payment service |
| Webhooks | HMAC signature verification with PSP secret, timestamp tolerance (5 min) to block replays, IP allow-list, idempotent on PSP event id | Payment service |
| Secrets | Vault / cloud KMS; injected at runtime; rotated; never in Git or images; DB passwords per service | Platform |
| Audit logging | Append-only `*_status_history` tables + structured audit log for admin actions (who, what, when, before/after); shipped to write-once storage | All services |
| Data protection | PII (email, phone) encrypted at rest (disk + column-level for phone); logs mask PII and tokens | DB, logging library |

### A2. Threats specific to a flash sale (STRIDE-lite)

| Threat | Example | Mitigation |
|---|---|---|
| Scalper bots | Scripts fire thousands of Buy requests | WAF bot detection, per-account limit enforced by DB unique index, waiting-room tokens, CAPTCHA on anomalies |
| Account farming | Many fake accounts to bypass 1-per-customer | Phone/OTP verified accounts eligible for sale; device fingerprint; post-sale fraud review before shipping |
| Replay / duplicate | Replaying a captured Pay request | Idempotency keys; JWT expiry; webhook timestamp + signature |
| Tampering | Changing price in request | Price computed server-side from `deal` table; client price ignored |
| Inventory DoS | Holding units with no intent to pay | Short TTL (5 min), 1 active hold per customer, hold abuse score |
| Elevation | Customer reads another customer's order | Ownership check on every resource; IDs are UUIDs (not guessable) |

## Part B — Observability

### B1. Key metrics (Prometheus, RED + business)

| Metric | Type | Labels | Why |
|---|---|---|---|
| `http_requests_total` | counter | route, status | Request rate, error rate |
| `http_request_duration_seconds` | histogram | route | Latency p50/p95/p99 |
| `rate_limited_total` | counter | layer (edge/gateway) | Throttling volume |
| `reservation_attempts_total` | counter | result (`reserved`, `sold_out_gate`, `sold_out_db`, `limit`, `error`) | Funnel; reservation failures |
| `inventory_available`, `inventory_reserved`, `inventory_sold` | gauge | sale, sku | Live stock |
| `inventory_conservation_delta` | gauge | sale, sku | `total − (available+reserved+sold)`, **must be 0** |
| `redis_gate_drift` | gauge | sale, sku | `gate_tokens − db_available`, should be ≈ 0 |
| `reservation_expired_total` | counter | sale | Abandonment |
| `payment_attempts_total` | counter | provider, outcome (`succeeded`, `failed`, `timeout`, `circuit_open`) | Payment failures |
| `payment_unknown_current` | gauge | provider | Money in limbo |
| `circuit_breaker_state` | gauge | dependency | 0 closed / 1 half-open / 2 open |
| `kafka_consumer_lag` | gauge | group, topic | Queue backlog |
| `dlq_messages_total` | counter | group | Poison/failed events |
| `orders_confirmed_total`, `order_confirmation_delay_seconds` | counter, histogram | | Order conversion and delay |
| `paid_without_order_current` | gauge | | Reconciliation gap, **must be 0 after 60 s** |
| `conversion_ratio` | derived | | orders confirmed / reservations |

### B2. Structured logs (JSON, one line per business event)

```json
{
  "ts": "2026-10-05T10:00:00.231Z",
  "level": "INFO",
  "service": "inventory",
  "event": "reservation.created",
  "traceId": "4bf92f3577b34da6a3ce929d0e0e4736",
  "spanId": "00f067aa0ba902b7",
  "saleId": "S1",
  "sku": "PRODUCT_X",
  "reservationId": "rsv_8f2c",
  "customerHash": "sha256:9c1…",
  "idempotencyKey": "buy-…",
  "availableAfter": 84,
  "latencyMs": 3
}
```

Business events logged: `reservation.created / rejected / expired / released / confirmed`, `payment.initiated / succeeded / failed / unknown / reconciled`, `order.created / confirmed / cancelled`, `circuit.opened / closed`, `dlq.message`. PII is hashed or masked; tokens never logged. Rejected sold-out requests are counted in metrics and **sampled** in logs (1 %) to avoid log floods during the burst.

### B3. Distributed tracing

* OpenTelemetry SDK in every service; W3C `traceparent` propagated over HTTP/gRPC and **copied into every Kafka event header** so async consumers continue the same trace.
* One trace = one customer purchase: gateway → checkout → inventory → payment → (Kafka) → order → fulfilment → notification.
* Sampling: 100 % for traces that reach reservation or payment (≈ hundreds per sale); 1 % for sold-out rejections.
* The prototype's **Request tracer** tab shows exactly this view: one customer's spans across 10 services in time order, including the multi-second gap while the Order Service was down.

### B4. Alerts

| Alert | Condition | Severity | First response |
|---|---|---|---|
| Inventory inconsistency | `inventory_conservation_delta != 0` or `inventory_sold > total` for any sample | **Page immediately** | Freeze sale (admin kill switch), investigate |
| Oversell guard hit | DB `CHECK` constraint violation logged | Page | Should be impossible; treat as incident |
| Payment failure spike | Failed or timeout ratio > 15 % over 1 min | Page | Check PSP status; breaker state |
| Payments stuck | `payment_unknown_current > 0` for > 5 min | High | Reconciler health; PSP status API |
| Paid without order | `paid_without_order_current > 0` for > 2 min | High | Order consumer lag, DLQ |
| Queue backlog | `kafka_consumer_lag` > 500 or growing for 1 min | High | Scale consumers; check downstream health |
| DLQ not empty | `dlq_messages_total` increase | Medium | Inspect, fix, replay |
| Gate drift | `|redis_gate_drift| > 5` for 1 min | Medium | Run gate re-sync job |
| Latency SLO | Reserve p99 > 200 ms for 2 min | Medium | Check DB lock wait, gateway CPU |

### B5. Dashboards

1. **Sale control room** (what the prototype's Live sale tab models): unit states, funnel per layer, invariants, inventory over time, order queue backlog, live event log.
2. **Service health**: RED metrics per service, pod count, CPU, DB connections.
3. **Payments**: outcomes by provider, breaker state, UNKNOWN count, reconciliation rate.
