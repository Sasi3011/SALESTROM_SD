# 04. Database / ER Design

PostgreSQL 16, **database per service**. Tables are grouped by owning service; foreign keys are enforced **inside** a service's database only. Cross-service references (for example `orders.payment_id`) are logical IDs, kept consistent by events and reconciliation. Full DDL: `schema.sql`.

![ER diagram: per-service databases](uml/er_diagram.svg)

<sub>PlantUML source: [`uml/er_diagram.puml`](uml/er_diagram.puml) · [PNG](uml/er_diagram.png). The Mermaid version below shows the same diagram as text and renders inline.</sub>

```mermaid
erDiagram
    CUSTOMER ||--o{ CART : owns
    CART ||--o{ CART_ITEM : contains
    CATEGORY ||--o{ PRODUCT : classifies
    PRODUCT ||--o{ CART_ITEM : "added as"
    SALE ||--o{ INVENTORY : "stocks"
    PRODUCT ||--o{ INVENTORY : "stocked as"
    SALE ||--o{ DEAL : offers
    COUPON }o--|| SALE : "valid for"
    INVENTORY ||--o{ INVENTORY_RESERVATION : holds
    CUSTOMER ||--o{ INVENTORY_RESERVATION : makes
    INVENTORY_RESERVATION ||--o| PAYMENT : "paid by"
    INVENTORY_RESERVATION ||--o| ORDERS : "becomes"
    CUSTOMER ||--o{ ORDERS : places
    ORDERS ||--|{ ORDER_ITEM : contains
    ORDERS ||--o{ ORDER_STATUS_HISTORY : "audited by"
    ORDERS ||--o| SHIPMENT : "shipped as"
    CUSTOMER ||--o{ NOTIFICATION : receives

    INVENTORY {
      bigint inventory_id PK
      uuid sale_id FK
      uuid product_id FK
      int total_quantity
      int available_quantity "CHECK >= 0"
      int reserved_quantity "CHECK >= 0"
      int sold_quantity "CHECK >= 0"
      bigint version
      timestamptz updated_at
    }
    INVENTORY_RESERVATION {
      uuid reservation_id PK
      bigint inventory_id FK
      uuid customer_id
      int quantity
      varchar status
      varchar idempotency_key "UNIQUE"
      timestamptz expires_at
      timestamptz created_at
      timestamptz updated_at
    }
    PAYMENT {
      uuid payment_id PK
      uuid reservation_id "UNIQUE"
      varchar idempotency_key "UNIQUE"
      varchar provider
      varchar provider_txn_id "UNIQUE"
      bigint amount_minor
      char currency
      varchar status
      int attempts
      timestamptz created_at
    }
    ORDERS {
      uuid order_id PK
      uuid reservation_id "UNIQUE"
      uuid customer_id
      uuid payment_id
      varchar status
      bigint total_minor
      bigint version
      timestamptz created_at
    }
    ORDER_ITEM {
      uuid order_item_id PK
      uuid order_id FK
      uuid product_id
      int quantity
      bigint unit_price_minor
    }
    SHIPMENT {
      uuid shipment_id PK
      uuid order_id "UNIQUE"
      varchar courier
      varchar tracking_number
      varchar status
    }
    SALE {
      uuid sale_id PK
      varchar name
      timestamptz starts_at
      timestamptz ends_at
      int per_customer_limit
      varchar status
    }
    CUSTOMER {
      uuid customer_id PK
      varchar email "UNIQUE"
      varchar phone
      varchar status
    }
    PRODUCT {
      uuid product_id PK
      uuid category_id FK
      varchar sku "UNIQUE"
      varchar name
      bigint list_price_minor
    }
    NOTIFICATION {
      uuid notification_id PK
      uuid customer_id
      varchar event_type
      varchar channel
      varchar status
      varchar dedup_key "UNIQUE"
    }
```

## Keys, constraints and indexes that carry the guarantees

| Guarantee | Enforced by |
|---|---|
| Stock never negative | `CHECK (available_quantity >= 0 AND reserved_quantity >= 0 AND sold_quantity >= 0)` |
| Stock conserved | `CHECK (available_quantity + reserved_quantity + sold_quantity = total_quantity)` |
| No oversell under concurrency | Conditional `UPDATE … WHERE available_quantity >= :qty` (row lock) |
| One reservation per request | `UNIQUE (idempotency_key)` on `inventory_reservation` |
| One active reservation per customer per sale | Partial unique index `ON inventory_reservation (inventory_id, customer_id) WHERE status IN ('RESERVED','PAYMENT_PENDING','CONFIRMED')` |
| One payment per reservation | `UNIQUE (reservation_id)` and `UNIQUE (idempotency_key)` on `payment` |
| One order per reservation | `UNIQUE (reservation_id)` on `orders` |
| One notification per event | `UNIQUE (dedup_key)` = event id + channel |
| Valid states only | `CHECK (status IN (...))` + application state machine |

| Index | Serves |
|---|---|
| `inventory (sale_id, product_id)` UNIQUE | Reservation hot path lookup |
| `inventory_reservation (status, expires_at) WHERE status='RESERVED'` | Expiry sweeper (`FOR UPDATE SKIP LOCKED`) |
| `payment (status, updated_at) WHERE status='UNKNOWN'` | Reconciler |
| `orders (customer_id, created_at DESC)` | "My orders" |
| `outbox (created_at) WHERE published_at IS NULL` | Outbox relay (if polling instead of CDC) |

## Transaction boundaries

| Transaction | Statements (one commit) | Isolation |
|---|---|---|
| Reserve | conditional UPDATE inventory; INSERT reservation; INSERT outbox | READ COMMITTED (row lock + guard re-check is enough) |
| Start payment | conditional UPDATE reservation status | READ COMMITTED |
| Payment result | UPDATE payment; INSERT outbox | READ COMMITTED |
| Confirm reservation | conditional UPDATE reservation; UPDATE inventory reserved→sold | READ COMMITTED |
| Expire | SELECT … FOR UPDATE SKIP LOCKED; UPDATE reservation; UPDATE inventory | READ COMMITTED |
| Order confirm | INSERT … ON CONFLICT DO NOTHING; conditional UPDATE orders; INSERT outbox; INSERT order_status_history | READ COMMITTED |

**Why READ COMMITTED is enough:** in PostgreSQL, a concurrent `UPDATE` that waits on a row lock re-evaluates its `WHERE` clause against the newly committed row version. The guard `available_quantity >= :qty` is therefore checked against the latest value, which is exactly the property we need. SERIALIZABLE would also be correct but adds abort-and-retry overhead on the hottest row.

**No distributed transactions.** Each transaction touches one service's database. Cross-service consistency comes from outbox events, idempotent consumers and reconciliation (saga with compensation: refund if an order cannot be fulfilled).

## Audit information

Every table carries `created_at`, `updated_at`. State changes are appended to `*_status_history` tables (who/what/when/from/to/trace_id). Payments additionally store raw PSP response references for dispute handling.
