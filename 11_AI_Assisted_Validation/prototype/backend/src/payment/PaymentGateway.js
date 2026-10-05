// DIP + ISP: PaymentService depends on this narrow interface, never on a concrete PSP SDK.
//   charge({ idempotencyKey, amount, currency, customerId }) -> { status: 'SUCCEEDED'|'FAILED', transactionId, declineCode? }
//   getStatus(idempotencyKey) -> { status: 'SUCCEEDED'|'FAILED'|'NOT_FOUND', transactionId? }
export class PaymentGateway {
  get provider() { throw new Error('not implemented'); }
  async charge() { throw new Error('not implemented'); }
  async getStatus() { throw new Error('not implemented'); }
}
export class GatewayTimeoutError extends Error { constructor(m = 'gateway timeout') { super(m); this.retryable = true; } }
export class GatewayUnavailableError extends Error { constructor(m = 'gateway 503') { super(m); this.retryable = true; } }
