# 02.4 Component Diagrams (C4 level 3) — critical services

## Inventory & reservation service

```mermaid
flowchart LR
    API[ReservationController<br/>REST/gRPC adapter] --> VAL[RequestValidator]
    VAL --> IDEM[IdempotencyGuard<br/>Redis SET NX + DB unique key]
    IDEM --> RS[ReservationService<br/><i>application service</i>]
    RS --> GATE[AdmissionGate<br/>Redis Lua token counter]
    RS --> STRAT[[ReservationStrategy<br/>AtomicConditionalUpdate]]
    STRAT --> REPO[InventoryRepository]
    RS --> RREPO[ReservationRepository]
    RS --> SM[ReservationStateMachine]
    RS --> OB[OutboxWriter]
    SWEEP[ExpirySweeper<br/>scheduled, SKIP LOCKED] --> RS
    CONS[PaymentEventConsumer<br/>idempotent] --> RS
    REPO & RREPO & OB --> DB[(inventory DB)]
    GATE --> R[(Redis)]
    IDEM --> R
```

| Component | Responsibility |
|---|---|
| ReservationController | HTTP/gRPC mapping, status codes, headers. No business logic. |
| RequestValidator | Schema, quantity = 1, sale is live, customer limit. |
| IdempotencyGuard | Same key → same result; concurrent duplicates wait for the first. |
| AdmissionGate | Fast in-memory sold-out answer; load shedding. |
| ReservationStrategy | Concurrency control (Strategy pattern); selected: atomic conditional update. |
| ReservationStateMachine | Legal transitions only (State pattern). |
| OutboxWriter | Writes events in the same DB transaction as state changes. |
| ExpirySweeper | Releases expired RESERVED holds. |
| PaymentEventConsumer | Confirms or releases on PaymentSucceeded / PaymentFailed. |

## Payment service

```mermaid
flowchart LR
    PC[PaymentController] --> PS[PaymentService]
    PS --> PREPO[PaymentRepository<br/>UNIQUE idempotency_key]
    PS --> CB[CircuitBreaker]
    CB --> PGI[[PaymentGateway interface]]
    PGI --> A1[CardPspAdapter]
    PGI --> A2[UpiPspAdapter]
    PF[PaymentProviderFactory] --> A1 & A2
    PS --> OB[OutboxWriter]
    WH[WebhookController<br/>signature check] --> PS
    REC[PaymentReconciler<br/>UNKNOWN → getStatus] --> PS
    PREPO & OB --> DB[(payment DB)]
```

## Order service

```mermaid
flowchart LR
    EC[PaymentEventConsumer<br/>ordered by reservation id] --> OS[OrderService]
    CC[CheckoutEventConsumer] --> OS
    OS --> OSM[OrderStateMachine]
    OS --> OREPO[OrderRepository<br/>UNIQUE reservation_id]
    OS --> OB[OutboxWriter]
    QAPI[OrderQueryController] --> OREPO
    DLQ[DLQ replay job] --> EC
```

## Checkout service (Facade)

```mermaid
flowchart LR
    CK[CheckoutController] --> F[CheckoutFacade]
    F --> IC[InventoryClient<br/>timeout 300 ms, no retry on 409]
    F --> PCl[PaymentClient<br/>timeout 3 s]
    F --> IDEM[IdempotencyGuard]
```
