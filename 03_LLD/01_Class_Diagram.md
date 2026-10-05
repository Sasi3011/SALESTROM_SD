# 03.1 Class Diagram — Inventory, Payment, Order

These classes exist in the prototype (`11_AI_Assisted_Validation/prototype/backend/src`). Names match the code so the jury can open any class.

```mermaid
classDiagram
    direction LR

    %% ---------- Inventory ----------
    class ReservationStrategy {
      <<interface>>
      +name: string
      +reserve(repo, qty) Result
    }
    class AtomicConditionalUpdate
    class OptimisticVersioning { -maxRetries: int }
    class PessimisticRowLock
    class NaiveReadThenWrite
    ReservationStrategy <|.. AtomicConditionalUpdate
    ReservationStrategy <|.. OptimisticVersioning
    ReservationStrategy <|.. PessimisticRowLock
    ReservationStrategy <|.. NaiveReadThenWrite

    class StrategyFactory { +create(name) ReservationStrategy }
    StrategyFactory ..> ReservationStrategy

    class InventoryRepository {
      -row: Inventory
      +read() Inventory
      +conditionalReserve(qty) bool
      +compareAndSet(version, values) bool
      +release(qty)
      +commitSale(qty)
    }
    class AdmissionGate { -tokens: int +tryAcquire(qty) bool +release(qty) }
    class IdempotencyStore { +execute(key, fn, isFinal) Result }

    class ReservationService {
      -ttlMs: int
      +reserve(cmd) ReservationResult
      +startPayment(reservationId) bool
      +resumeHold(reservationId)
      +onPaymentSucceeded(event)
      +onPaymentFailed(event)
      +onOrderConfirmed(event)
      +expireStale()
    }
    class Reservation {
      +id
      +customerId
      +idempotencyKey
      +qty
      +status: ReservationStatus
      +expiresAt
      +history[]
    }
    ReservationService --> ReservationStrategy : uses
    ReservationService --> InventoryRepository
    ReservationService --> AdmissionGate
    ReservationService --> IdempotencyStore
    ReservationService --> Outbox
    ReservationService "1" o-- "*" Reservation

    %% ---------- Payment ----------
    class PaymentGateway {
      <<interface>>
      +charge(request) ChargeResult
      +getStatus(idempotencyKey) StatusResult
    }
    class MockPspAdapter
    PaymentGateway <|.. MockPspAdapter
    class PaymentProviderFactory { +create(method, cfg) PaymentGateway }
    PaymentProviderFactory ..> PaymentGateway
    class CircuitBreaker {
      -state: CLOSED|OPEN|HALF_OPEN
      -failureThreshold
      -openMs
      +call(fn)
    }
    class PaymentService {
      -timeoutMs
      +charge(cmd) PaymentResult
      +reconcile()
    }
    class Payment {
      +id
      +idempotencyKey
      +reservationId
      +status: PaymentStatus
      +transactionId
      +attempts
    }
    PaymentService --> PaymentGateway
    PaymentService --> CircuitBreaker
    PaymentService --> Outbox
    PaymentService "1" o-- "*" Payment

    %% ---------- Order ----------
    class OrderService {
      +handle(topic, event)
      +startProcessing(event)
    }
    class Order {
      +id
      +reservationId
      +paymentId
      +status: OrderStatus
      +history[]
    }
    class OrderStateMachine { <<table>> ORDER_TRANSITIONS }
    OrderService --> OrderStateMachine
    OrderService "1" o-- "*" Order
    OrderService --> Outbox

    %% ---------- Orchestration & infra ----------
    class CheckoutFacade {
      +reserve(cmd)
      +pay(cmd)
    }
    CheckoutFacade --> ReservationService
    CheckoutFacade --> PaymentService
    CheckoutFacade --> IdempotencyStore

    class ApiGateway { +postReservation(req) +postPayment(req) }
    class TokenBucket { +tryTake() bool }
    ApiGateway --> CheckoutFacade
    ApiGateway --> TokenBucket

    class Outbox { +append(topic, payload) +relay() }
    class EventBus {
      +subscribe(group, topics, handler, opts)
      +publish(topic, payload)
      +replayDlq()
    }
    Outbox --> EventBus
    class NotificationService { +handle(topic, event) }
    EventBus ..> OrderService : delivers
    EventBus ..> ReservationService : delivers
    EventBus ..> NotificationService : delivers
```

## Responsibilities and where cross-cutting concerns live

| Concern | Lives in | Not in |
|---|---|---|
| Authentication, rate limiting, input validation | `ApiGateway`, `TokenBucket` | Domain services |
| Idempotency (HTTP) | `IdempotencyStore` used by `ReservationService` and `CheckoutFacade` | Controllers |
| Idempotency (payments) | `PaymentService` (UNIQUE key) + PSP key de-duplication | Checkout |
| Idempotency (events) | Every consumer checks current state before acting (`if status !== PAYMENT_PENDING return`) | Event bus |
| Concurrency control | `ReservationStrategy` implementation, executed by the database | Application memory |
| State legality | `ReservationStateMachine`, `OrderStateMachine` | Scattered `if` statements |
| Error handling for PSP | `CircuitBreaker` + `PaymentService` (UNKNOWN, reconcile) | Customer-facing code |
| Retries for events | `EventBus` consumer group (backoff, DLQ) | Business handlers |
