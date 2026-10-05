# SALESTORM prototype — flash-sale validation engine + control-room dashboard

A small, targeted prototype that validates the design's critical assumptions: no oversell under 10,000 concurrent buyers, idempotent reservations and payments, reservation expiry, payment timeouts with reconciliation, and order recovery after an Order Service outage.

## Run it

Requirements: Node.js 18+ (tested on 22).

```bash
# 1. backend (simulation engine + REST sandbox) on :4000
cd backend
npm install
npm test            # 11 checks, ~15 s
npm start

# 2. dashboard — either build once and let the backend serve it …
cd ../frontend
npm install
npm run build       # then open http://localhost:4000

# … or run the dev server with hot reload on :5173 (proxies /api to :4000)
npm run dev
```

## Dashboard tabs

| Tab | Use it to show the jury |
|---|---|
| **Live sale** | Press *Start flash sale*. 100 squares = 100 units changing state live; request path funnel per layer; 7 correctness guarantees; inventory and order-queue charts; live event log. Toggle strategy/gate/outages in the left panel. |
| **Request tracer** | One click per brief scenario: successful purchase, failed payment, duplicate Buy, paid-then-Order-Service-down, payment timeout, expiry, sold out, throttled. Full timeline across services. |
| **Concurrency lab** | Runs naive / pessimistic / optimistic / atomic / atomic+gate against one row and compares correctness, DB calls and latency. |

## Code map (matches 03_LLD class diagram)

```
backend/src
├── core/          EventBus (Kafka stand-in, retries, DLQ), Outbox, Tracer, Metrics, Clock
├── gateway/       ApiGateway (auth, validation, status codes), TokenBucket rate limiter
├── inventory/     InventoryRepository (SQL per method), AdmissionGate (Redis gate),
│                  IdempotencyStore, ReservationService, ReservationStateMachine,
│                  strategies/ (Strategy + Factory)
├── payment/       PaymentGateway interface, MockPspAdapter (Adapter), PaymentProviderFactory,
│                  CircuitBreaker, PaymentService (idempotency, reconciliation)
├── order/         OrderService (event-driven, idempotent), OrderStateMachine
├── notification/  NotificationService (Observer)
├── checkout/      CheckoutFacade (Facade)
├── simulation/    System.js (composition root), LoadSimulator, Benchmark, InvariantChecker, config
└── server.js      Express API + Server-Sent Events
```

Time is compressed 10×: 3,000 ms of outage in the simulator represents the brief's 30 s; a 2,500 ms TTL represents ~5 min (scaled for demo pace).
