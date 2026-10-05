// API Gateway: authentication, input validation, rate limiting, routing, status mapping.
// Returns HTTP-shaped responses so the simulation exercises the same contract as the REST API.
const STATUS = {
  RESERVED: 201, SOLD_OUT: 409, LIMIT_EXCEEDED: 409, CONTENTION: 503,
  PAID: 200, PAYMENT_FAILED: 402, PAYMENT_PROCESSING: 202, PAYMENT_UNAVAILABLE: 503,
  RESERVATION_EXPIRED: 410, NOT_FOUND: 404,
};

export class ApiGateway {
  constructor({ checkout, limiter, metrics, tracer }) { Object.assign(this, { checkout, limiter, metrics, tracer }); }

  #admit(traceId, token) {
    this.metrics.inc('http.requests');
    if (!token) return { status: 401, body: { error: 'UNAUTHENTICATED' } };
    if (!this.limiter.tryTake()) {
      this.metrics.inc('http.429');
      this.tracer.span(traceId, 'API gateway', '429 Too Many Requests (token bucket empty), Retry-After sent', 'debug');
      return { status: 429, body: { error: 'RATE_LIMITED', retryAfterMs: 300 } };
    }
    return null;
  }

  async postReservation({ token, customerId, idempotencyKey, productId, qty, traceId }) {
    const rejected = this.#admit(traceId, token); if (rejected) return rejected;
    if (!idempotencyKey || !productId || qty !== 1) { this.metrics.inc('http.400'); return { status: 400, body: { error: 'VALIDATION_FAILED' } }; }
    const body = await this.checkout.reserve({ customerId, idempotencyKey, qty, traceId });
    return { status: body.replayed ? 200 : STATUS[body.status] ?? 500, body };
  }

  async postPayment({ token, customerId, idempotencyKey, reservationId, traceId }) {
    const rejected = this.#admit(traceId, token); if (rejected) return rejected;
    if (!idempotencyKey || !reservationId) { this.metrics.inc('http.400'); return { status: 400, body: { error: 'VALIDATION_FAILED' } }; }
    const body = await this.checkout.pay({ customerId, reservationId, idempotencyKey, traceId });
    return { status: STATUS[body.status] ?? 500, body };
  }
}
