# 03.3 Sequence — Payment (success, failure, timeout, duplicate, gateway down)

```mermaid
sequenceDiagram
    autonumber
    actor C as Customer
    participant CK as Checkout (facade)
    participant INV as Inventory service
    participant PAY as Payment service
    participant CB as Circuit breaker
    participant PSP as External PSP
    participant OB as Outbox → Kafka

    C->>CK: POST /checkout/payments {reservationId}<br/>Idempotency-Key: p1
    CK->>CK: idempotency check on p1 (duplicate Pay waits / replays)
    CK->>INV: startPayment(reservationId)
    Note over INV: UPDATE reservation SET status='PAYMENT_PENDING'<br/>WHERE id=? AND status='RESERVED' AND expires_at > now()
    alt reservation expired or not owned
        INV-->>CK: false
        CK-->>C: 410 RESERVATION_EXPIRED
    end
    CK->>OB: CheckoutStarted (order draft)
    CK->>PAY: charge(reservationId)
    PAY->>PAY: INSERT payment (idempotency_key = pay_{reservationId}) UNIQUE
    PAY->>CB: call()
    alt circuit OPEN
        CB-->>PAY: fail fast (PSP not called)
        PAY-->>CK: UNAVAILABLE
        CK->>INV: resumeHold (back to RESERVED, TTL keeps running)
        CK-->>C: 503 Retry-After: 2
    else circuit CLOSED / HALF_OPEN
        CB->>PSP: POST /charges Idempotency-Key: pay_{reservationId} (timeout 3 s)
        alt PSP approves
            PSP-->>PAY: SUCCEEDED txn_123
            PAY->>OB: same TX: payment=SUCCEEDED + PaymentSucceeded
            PAY-->>CK: SUCCEEDED
            CK-->>C: 200 PAID, order confirming
        else PSP declines
            PSP-->>PAY: FAILED card_declined
            PAY->>OB: same TX: payment=FAILED + PaymentFailed
            CK-->>C: 402 PAYMENT_FAILED
        else timeout / connection reset
            PAY->>PAY: payment=UNKNOWN (never guess)
            CK-->>C: 202 PAYMENT_PROCESSING
            loop Reconciler every 30 s (prototype: 300 ms)
                PAY->>PSP: GET /charges?idempotency_key=pay_{reservationId}
                alt PSP has record
                    PSP-->>PAY: SUCCEEDED or FAILED
                    PAY->>OB: payment=result + PaymentSucceeded/Failed
                else PSP has no record
                    PAY->>PSP: retry charge with SAME key (safe)
                end
            end
        end
    end

    Note over OB,INV: Async consumers (idempotent)
    OB-->>INV: PaymentSucceeded → reservation CONFIRMED, reserved-1, sold+1
    OB-->>INV: PaymentFailed → PAYMENT_FAILED → RELEASED, available+1, gate token +1
```

| Scenario (Challenge C) | Behaviour | Proven by |
|---|---|---|
| Payment succeeds | Payment + event in one TX; inventory and order follow via events | Trace "Successful purchase" |
| Payment fails | Event releases the unit; order cancelled; customer notified | Test `failed payment releases the unit`; trace "Failed payment" |
| Payment times out | UNKNOWN → reconcile by status lookup → same-key retry if absent | Trace "Payment timeout" (no double charge invariant) |
| Duplicate payment request | Checkout idempotency (p1) + payment UNIQUE key + PSP key = three layers | Test `duplicate Pay requests charge the card once` |
| Payment succeeds, Order fails | See order sequence | Trace "Paid, then Order Service down" |
