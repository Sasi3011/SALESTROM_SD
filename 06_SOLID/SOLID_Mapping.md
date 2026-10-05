# 06. SOLID Mapping

Every row points at a real file in `11_AI_Assisted_Validation/prototype/backend/src`, so each claim can be checked in the code.

| Principle | Where | How it is applied | What it buys us |
|---|---|---|---|
| **S**ingle Responsibility | `ReservationService`, `PaymentService`, `OrderService`, `NotificationService` | Each owns one domain and one data set. Payment never touches stock; Order never calls the PSP; Notification only reacts to events. Controllers (`ApiGateway`) only map HTTP and enforce limits. | A PSP change cannot break inventory logic; each service can be scaled and deployed alone. |
| | `InventoryRepository` | Only class that issues inventory SQL. | Concurrency-critical SQL lives in one reviewable place. |
| | `CircuitBreaker` | Only decides "may I call the dependency now". | Reusable for PSP, courier and SMS adapters. |
| **O**pen/Closed | `inventory/strategies/*` + `StrategyFactory` | New concurrency approach = new class + one registry line. `ReservationService` unchanged. We added 4 strategies this way. | Comparing approaches in the Concurrency Lab needed zero changes to the service. |
| | `payment/PaymentProviderFactory` | New PSP (wallet, BNPL) = new adapter + one registry line. | See "adding a provider" below. |
| | `ORDER_TRANSITIONS`, `RESERVATION_TRANSITIONS` | Lifecycle changes are table edits, not new `if` chains. | Adding `RETURN_REQUESTED` touches one table. |
| **L**iskov Substitution | `ReservationStrategy` subclasses; `PaymentGateway` implementations | All strategies return the same `{ ok, reason, conflicts }` shape and honour the same contract (never report success without reserving). Any `PaymentGateway` can replace another; all treat the idempotency key the same way. | The simulator swaps strategies at runtime; tests run each strategy through identical assertions. |
| **I**nterface Segregation | `PaymentGateway` has only `charge` and `getStatus`; `ReservationStrategy` has only `reserve` | Callers depend on the two methods they use, not a full PSP SDK (refunds, disputes, payouts live in separate interfaces). | Mocking for tests is trivial; adapters stay small. |
| | Event handlers | Each consumer group subscribes only to the topics it needs (`bus.subscribe(group, topics, handler)`). | No service receives events it must ignore. |
| **D**ependency Inversion | `simulation/System.js` (composition root) | Every service receives its dependencies through the constructor: `PaymentService({ gateway, breaker, outbox, … })`. High-level services depend on `PaymentGateway`, `ReservationStrategy`, `Outbox` abstractions. Only `System.js` knows concrete classes. | Tests build a system with 100 % success PSP, zero TTL, etc. without touching service code. |

## Showing extensibility with minimal change

| Change | Files touched | Unchanged |
|---|---|---|
| **New payment provider** (e.g. a wallet PSP) | `payment/WalletPspAdapter.js` (new, implements `PaymentGateway`); one line in `PaymentProviderFactory` | `PaymentService`, `CheckoutFacade`, Order, Inventory |
| **New pricing strategy** (e.g. tiered flash price: first 50 units ₹4,999, rest ₹5,499) | New `TieredPricing` implementing `PricingStrategy.price(sale, unitIndex)`; `deal.pricing_strategy = 'TIERED'` | Checkout flow, Payment |
| **New delivery partner** | New `CourierXAdapter` implementing `CourierGateway.createShipment / track`; registry entry; `shipment.courier` value | Order, Notification |
| **New concurrency control** (e.g. bucketed inventory rows) | New `BucketedAtomicUpdate` strategy | `ReservationService`, API |
