# 03.5 State Diagrams — Reservation and Order

## Reservation lifecycle (Challenge B)

![State diagram: reservation lifecycle](uml/05_state_reservation.svg)

<sub>PlantUML source: [`uml/05_state_reservation.puml`](uml/05_state_reservation.puml) · [PNG](uml/05_state_reservation.png). The Mermaid version below shows the same diagram as text and renders inline.</sub>

```mermaid
stateDiagram-v2
    [*] --> AVAILABLE
    AVAILABLE --> RESERVED: reserve() guard available ≥ 1
    RESERVED --> PAYMENT_PENDING: startPayment() before expires_at
    RESERVED --> TIMEOUT: sweeper, expires_at passed
    PAYMENT_PENDING --> CONFIRMED: PaymentSucceeded
    PAYMENT_PENDING --> PAYMENT_FAILED: PaymentFailed
    PAYMENT_PENDING --> RESERVED: PSP circuit open (retry allowed)
    CONFIRMED --> SOLD: OrderConfirmed
    PAYMENT_FAILED --> RELEASED: available +1
    TIMEOUT --> RELEASED: available +1
    RELEASED --> [*]
    SOLD --> [*]
```

| Transition | Stock counters | Owner |
|---|---|---|
| → RESERVED | available −1, reserved +1 | Inventory (sync) |
| RESERVED → PAYMENT_PENDING | none | Inventory, called by Checkout |
| → CONFIRMED | reserved −1, sold +1 | Inventory (event) |
| → RELEASED | reserved −1, available +1, Redis token +1 | Inventory (event or sweeper) |

**Design rule:** the sweeper expires only `RESERVED`, never `PAYMENT_PENDING`. Once money may be moving, the payment reconciler owns the outcome. This removes the "customer paid one second after expiry" race completely.

## Order lifecycle (Challenge D)

![State diagram: order lifecycle](uml/06_state_order.svg)

<sub>PlantUML source: [`uml/06_state_order.puml`](uml/06_state_order.puml) · [PNG](uml/06_state_order.png). The Mermaid version below shows the same diagram as text and renders inline.</sub>

```mermaid
stateDiagram-v2
    [*] --> CREATED: CheckoutStarted
    CREATED --> PAYMENT_PENDING
    PAYMENT_PENDING --> CONFIRMED: PaymentSucceeded
    PAYMENT_PENDING --> CANCELLED: PaymentFailed
    CONFIRMED --> PROCESSING: fulfilment accepted
    CONFIRMED --> CANCELLED: cannot fulfil → refund (compensation)
    PROCESSING --> SHIPPED: courier pickup
    SHIPPED --> OUT_FOR_DELIVERY
    OUT_FOR_DELIVERY --> DELIVERED
    DELIVERED --> [*]
    CANCELLED --> [*]
```

Both machines are implemented as transition tables (`RESERVATION_TRANSITIONS`, `ORDER_TRANSITIONS`). Any transition not in the table throws `IllegalTransitionError`, so an out-of-order or duplicate event can never corrupt state. Every transition is appended to `history` (audit).
