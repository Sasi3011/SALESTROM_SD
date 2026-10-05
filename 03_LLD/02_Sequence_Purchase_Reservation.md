# 03.2 Sequence — Purchase & Reservation

Covers: successful reservation, duplicate request, inventory at zero, last-unit race.

![Sequence diagram: purchase and reservation](uml/02_sequence_purchase_reservation.svg)

<sub>PlantUML source: [`uml/02_sequence_purchase_reservation.puml`](uml/02_sequence_purchase_reservation.puml) · [PNG](uml/02_sequence_purchase_reservation.png). The Mermaid version below shows the same diagram as text and renders inline.</sub>

```mermaid
sequenceDiagram
    autonumber
    actor C as Customer
    participant GW as API gateway
    participant CK as Checkout (facade)
    participant ID as Idempotency (Redis)
    participant G as Stock gate (Redis Lua)
    participant INV as Inventory service
    participant DB as Inventory DB

    C->>GW: POST /sales/S1/reservations<br/>Idempotency-Key: k1, JWT
    GW->>GW: verify JWT, validate body, token bucket
    alt bucket empty
        GW-->>C: 429 Too Many Requests, Retry-After: 1
    end
    GW->>CK: reserve(customer, k1, qty=1)
    CK->>INV: reserve(...)
    INV->>ID: SET idem:k1 IN_PROGRESS NX EX 86400
    alt key exists and completed
        ID-->>INV: stored result
        INV-->>C: 200 original response, Idempotent-Replayed: true
    else key exists, still in progress
        INV-->>INV: wait for first request's result (no second reservation)
    end
    INV->>INV: per-customer limit check (unique active reservation)
    INV->>G: EVAL decr_if_enough(stock:S1:X, 1)
    alt tokens = 0
        G-->>INV: -1
        INV-->>C: 409 SOLD_OUT (database never touched)
    else token acquired
        G-->>INV: remaining tokens
        INV->>DB: BEGIN
        INV->>DB: UPDATE inventory SET available=available-1, reserved=reserved+1<br/>WHERE ... AND available >= 1
        alt 0 rows updated
            DB-->>INV: 0
            INV->>DB: ROLLBACK
            INV->>G: INCRBY stock:S1:X 1 (return token)
            INV-->>C: 409 SOLD_OUT
        else 1 row updated
            INV->>DB: INSERT inventory_reservation (status RESERVED, expires_at = now()+5 min, idempotency_key k1)
            INV->>DB: INSERT outbox (ReservationCreated)
            INV->>DB: COMMIT
            INV->>ID: SET idem:k1 = {201, reservationId}
            INV-->>CK: RESERVED
            CK-->>GW: 201 Created {reservationId, expiresAt}
            GW-->>C: 201 Created
        end
    end
```

**Transaction boundary:** steps 13–17 are one database transaction. The stock decrement, the reservation row and the outbox event commit together or not at all.

**Last-unit race (two requests, one unit):** both may pass the gate only if it had two tokens; both reach step 13. The database serialises the two `UPDATE` statements on the row lock. The first sees `available = 1` and updates 1 row; the second re-evaluates the guard against the committed value `available = 0` and updates 0 rows. Exactly one wins, deterministically, with no application-level lock. Validated by test `last unit: two simultaneous buyers, exactly one wins` (50 repetitions).
