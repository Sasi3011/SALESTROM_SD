-- SALESTORM schema (PostgreSQL 16). One section per owning service / database.
-- Money is stored in minor units (paise) as BIGINT. All timestamps are timestamptz (UTC).

-- =====================================================================
-- Catalog & sale database
-- =====================================================================
CREATE TABLE category (
  category_id   UUID PRIMARY KEY,
  name          VARCHAR(120) NOT NULL,
  parent_id     UUID REFERENCES category(category_id)
);

CREATE TABLE product (
  product_id       UUID PRIMARY KEY,
  category_id      UUID NOT NULL REFERENCES category(category_id),
  sku              VARCHAR(64) NOT NULL UNIQUE,
  name             VARCHAR(200) NOT NULL,
  description      TEXT,
  list_price_minor BIGINT NOT NULL CHECK (list_price_minor >= 0),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE sale (
  sale_id             UUID PRIMARY KEY,
  name                VARCHAR(200) NOT NULL,
  starts_at           TIMESTAMPTZ NOT NULL,
  ends_at             TIMESTAMPTZ NOT NULL,
  per_customer_limit  INT NOT NULL DEFAULT 1 CHECK (per_customer_limit > 0),
  status              VARCHAR(16) NOT NULL CHECK (status IN ('SCHEDULED','LIVE','ENDED','CANCELLED')),
  CHECK (ends_at > starts_at)
);

CREATE TABLE deal (
  deal_id           UUID PRIMARY KEY,
  sale_id           UUID NOT NULL REFERENCES sale(sale_id),
  product_id        UUID NOT NULL REFERENCES product(product_id),
  sale_price_minor  BIGINT NOT NULL CHECK (sale_price_minor >= 0),
  pricing_strategy  VARCHAR(32) NOT NULL DEFAULT 'FIXED',   -- Strategy pattern key
  UNIQUE (sale_id, product_id)
);

CREATE TABLE coupon (
  coupon_id      UUID PRIMARY KEY,
  sale_id        UUID REFERENCES sale(sale_id),
  code           VARCHAR(32) NOT NULL UNIQUE,
  discount_type  VARCHAR(16) NOT NULL CHECK (discount_type IN ('PERCENT','FLAT')),
  discount_value BIGINT NOT NULL CHECK (discount_value > 0),
  max_uses       INT,
  used_count     INT NOT NULL DEFAULT 0,
  CHECK (max_uses IS NULL OR used_count <= max_uses)
);

-- =====================================================================
-- Customer / cart database
-- =====================================================================
CREATE TABLE customer (
  customer_id  UUID PRIMARY KEY,
  email        VARCHAR(254) NOT NULL UNIQUE,
  phone        VARCHAR(20),
  status       VARCHAR(16) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','BLOCKED')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE cart (
  cart_id      UUID PRIMARY KEY,
  customer_id  UUID NOT NULL REFERENCES customer(customer_id),
  status       VARCHAR(16) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CHECKED_OUT','ABANDONED')),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ux_cart_open_per_customer ON cart (customer_id) WHERE status = 'OPEN';

CREATE TABLE cart_item (
  cart_item_id UUID PRIMARY KEY,
  cart_id      UUID NOT NULL REFERENCES cart(cart_id) ON DELETE CASCADE,
  product_id   UUID NOT NULL,
  quantity     INT NOT NULL CHECK (quantity > 0),
  UNIQUE (cart_id, product_id)
);

-- =====================================================================
-- Inventory database  (owned by Inventory & Reservation service)
-- =====================================================================
CREATE TABLE inventory (
  inventory_id        BIGSERIAL PRIMARY KEY,
  sale_id             UUID NOT NULL,
  product_id          UUID NOT NULL,
  total_quantity      INT NOT NULL CHECK (total_quantity >= 0),
  available_quantity  INT NOT NULL CHECK (available_quantity >= 0),
  reserved_quantity   INT NOT NULL DEFAULT 0 CHECK (reserved_quantity >= 0),
  sold_quantity       INT NOT NULL DEFAULT 0 CHECK (sold_quantity >= 0),
  version             BIGINT NOT NULL DEFAULT 0,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (sale_id, product_id),
  CONSTRAINT stock_conserved CHECK (available_quantity + reserved_quantity + sold_quantity = total_quantity)
);

CREATE TABLE inventory_reservation (
  reservation_id   UUID PRIMARY KEY,
  inventory_id     BIGINT NOT NULL REFERENCES inventory(inventory_id),
  customer_id      UUID NOT NULL,
  quantity         INT NOT NULL CHECK (quantity > 0),
  status           VARCHAR(16) NOT NULL CHECK (status IN
                     ('RESERVED','PAYMENT_PENDING','CONFIRMED','SOLD','PAYMENT_FAILED','TIMEOUT','RELEASED')),
  idempotency_key  VARCHAR(128) NOT NULL UNIQUE,
  expires_at       TIMESTAMPTZ NOT NULL,
  trace_id         VARCHAR(64),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- one active hold per customer per sale item
CREATE UNIQUE INDEX ux_active_reservation_per_customer
  ON inventory_reservation (inventory_id, customer_id)
  WHERE status IN ('RESERVED','PAYMENT_PENDING','CONFIRMED');
-- expiry sweeper
CREATE INDEX ix_reservation_expiry ON inventory_reservation (expires_at) WHERE status = 'RESERVED';

CREATE TABLE reservation_status_history (
  id              BIGSERIAL PRIMARY KEY,
  reservation_id  UUID NOT NULL REFERENCES inventory_reservation(reservation_id),
  from_status     VARCHAR(16),
  to_status       VARCHAR(16) NOT NULL,
  reason          VARCHAR(64),
  trace_id        VARCHAR(64),
  changed_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Transactional outbox (one per service database; same shape everywhere)
CREATE TABLE outbox (
  event_id      UUID PRIMARY KEY,
  aggregate_id  VARCHAR(64) NOT NULL,          -- Kafka partition key (reservation id)
  event_type    VARCHAR(64) NOT NULL,
  payload       JSONB NOT NULL,
  trace_id      VARCHAR(64),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at  TIMESTAMPTZ
);
CREATE INDEX ix_outbox_unpublished ON outbox (created_at) WHERE published_at IS NULL;

-- Consumer de-duplication (processed event ids), used by every consumer
CREATE TABLE processed_event (
  consumer      VARCHAR(64) NOT NULL,
  event_id      UUID NOT NULL,
  processed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (consumer, event_id)
);

-- ---- The concurrency-critical statements ----
-- Reserve (1 row = success, 0 rows = sold out):
--   UPDATE inventory
--      SET available_quantity = available_quantity - $qty,
--          reserved_quantity  = reserved_quantity  + $qty,
--          version = version + 1, updated_at = now()
--    WHERE sale_id = $sale AND product_id = $product AND available_quantity >= $qty;
-- Release:
--   UPDATE inventory SET available_quantity = available_quantity + $qty,
--          reserved_quantity = reserved_quantity - $qty, version = version + 1 WHERE inventory_id = $id;
-- Commit sale:
--   UPDATE inventory SET reserved_quantity = reserved_quantity - $qty,
--          sold_quantity = sold_quantity + $qty, version = version + 1 WHERE inventory_id = $id;
-- Expiry sweeper batch:
--   SELECT reservation_id FROM inventory_reservation
--    WHERE status = 'RESERVED' AND expires_at < now()
--    ORDER BY expires_at LIMIT 500 FOR UPDATE SKIP LOCKED;

-- =====================================================================
-- Payment database  (owned by Payment service)
-- =====================================================================
CREATE TABLE payment (
  payment_id        UUID PRIMARY KEY,
  reservation_id    UUID NOT NULL UNIQUE,
  customer_id       UUID NOT NULL,
  idempotency_key   VARCHAR(128) NOT NULL UNIQUE,
  provider          VARCHAR(32) NOT NULL,
  provider_txn_id   VARCHAR(128) UNIQUE,
  amount_minor      BIGINT NOT NULL CHECK (amount_minor > 0),
  currency          CHAR(3) NOT NULL DEFAULT 'INR',
  status            VARCHAR(16) NOT NULL CHECK (status IN ('INITIATED','SUCCEEDED','FAILED','UNKNOWN','REFUNDED')),
  decline_code      VARCHAR(64),
  attempts          INT NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_payment_unknown ON payment (updated_at) WHERE status = 'UNKNOWN';

CREATE TABLE payment_attempt (           -- audit of every PSP call
  attempt_id     BIGSERIAL PRIMARY KEY,
  payment_id     UUID NOT NULL REFERENCES payment(payment_id),
  request_at     TIMESTAMPTZ NOT NULL,
  response_at    TIMESTAMPTZ,
  outcome        VARCHAR(16) NOT NULL,      -- SUCCEEDED / FAILED / TIMEOUT / CIRCUIT_OPEN
  psp_reference  VARCHAR(128),
  trace_id       VARCHAR(64)
);

-- =====================================================================
-- Order database  (owned by Order service; shipment owned by Fulfilment)
-- =====================================================================
CREATE TABLE orders (
  order_id        UUID PRIMARY KEY,
  reservation_id  UUID NOT NULL UNIQUE,
  customer_id     UUID NOT NULL,
  payment_id      UUID,
  status          VARCHAR(20) NOT NULL CHECK (status IN
                    ('CREATED','PAYMENT_PENDING','CONFIRMED','PROCESSING','SHIPPED','OUT_FOR_DELIVERY','DELIVERED','CANCELLED')),
  total_minor     BIGINT NOT NULL CHECK (total_minor >= 0),
  version         BIGINT NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_orders_customer ON orders (customer_id, created_at DESC);

CREATE TABLE order_item (
  order_item_id     UUID PRIMARY KEY,
  order_id          UUID NOT NULL REFERENCES orders(order_id),
  product_id        UUID NOT NULL,
  quantity          INT NOT NULL CHECK (quantity > 0),
  unit_price_minor  BIGINT NOT NULL CHECK (unit_price_minor >= 0)
);

CREATE TABLE order_status_history (
  id          BIGSERIAL PRIMARY KEY,
  order_id    UUID NOT NULL REFERENCES orders(order_id),
  from_status VARCHAR(20),
  to_status   VARCHAR(20) NOT NULL,
  reason      VARCHAR(64),
  trace_id    VARCHAR(64),
  changed_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE shipment (
  shipment_id      UUID PRIMARY KEY,
  order_id         UUID NOT NULL UNIQUE,
  courier          VARCHAR(32) NOT NULL,          -- Adapter key for courier partner
  tracking_number  VARCHAR(64) UNIQUE,
  status           VARCHAR(20) NOT NULL CHECK (status IN ('CREATED','PICKED_UP','IN_TRANSIT','OUT_FOR_DELIVERY','DELIVERED','FAILED')),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =====================================================================
-- Notification database
-- =====================================================================
CREATE TABLE notification (
  notification_id UUID PRIMARY KEY,
  customer_id     UUID NOT NULL,
  event_type      VARCHAR(64) NOT NULL,
  channel         VARCHAR(16) NOT NULL CHECK (channel IN ('EMAIL','SMS','PUSH')),
  status          VARCHAR(16) NOT NULL CHECK (status IN ('PENDING','SENT','FAILED')),
  dedup_key       VARCHAR(160) NOT NULL UNIQUE,   -- event_id + channel
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
