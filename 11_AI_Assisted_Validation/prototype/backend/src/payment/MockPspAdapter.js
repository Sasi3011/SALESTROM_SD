// Adapter pattern: wraps an external payment service provider (PSP) and translates its
// API into our PaymentGateway interface. This mock behaves like a real PSP:
//  - it de-duplicates on the idempotency key we send (gateway-side idempotency);
//  - some responses are lost in transit (we see a timeout, but the charge may have happened);
//  - during an outage it hangs/returns 503.
import { PaymentGateway, GatewayUnavailableError } from './PaymentGateway.js';
import { sleep, rand, chance } from '../core/util.js';

export class MockPspAdapter extends PaymentGateway {
  constructor({ name, successPct, lostResponsePct, latency, clock, isDown }) {
    super();
    Object.assign(this, { name, successPct, lostResponsePct, latency, clock, isDown });
    this.ledger = new Map();   // PSP-side record: idempotencyKey -> { status, transactionId, executions }
    this.calls = 0;
    this.dedupHits = 0;
    this.seq = 0;
  }
  get provider() { return this.name; }

  async charge({ idempotencyKey }) {
    this.calls++;
    if (this.isDown()) { await sleep(rand(30, 60)); throw new GatewayUnavailableError(); }
    const existing = this.ledger.get(idempotencyKey);
    if (existing) {                 // PSP has already processed (or is processing) this key
      this.dedupHits++;
      await sleep(rand(this.latency.min, this.latency.max));
      return { status: existing.status, transactionId: existing.transactionId, deduplicated: true };
    }
    const status = chance(this.successPct) ? 'SUCCEEDED' : 'FAILED';
    const entry = { status, transactionId: `${this.name}_txn_${++this.seq}`, executions: 1, at: this.clock.now() };
    this.ledger.set(idempotencyKey, entry);   // money moves exactly here, once per key
    const responseLost = chance(this.lostResponsePct);
    await sleep(responseLost ? 3_000 : rand(this.latency.min, this.latency.max)); // lost = caller times out first
    return { status, transactionId: entry.transactionId, declineCode: status === 'FAILED' ? 'card_declined' : undefined };
  }

  async getStatus(idempotencyKey) {
    if (this.isDown()) throw new GatewayUnavailableError();
    await sleep(rand(10, 30));
    const e = this.ledger.get(idempotencyKey);
    return e ? { status: e.status, transactionId: e.transactionId } : { status: 'NOT_FOUND' };
  }

  // Audit helper used by the invariant checker: executions per key must be 1.
  executionsPerKey() { return [...this.ledger.values()].map((e) => e.executions); }
}
