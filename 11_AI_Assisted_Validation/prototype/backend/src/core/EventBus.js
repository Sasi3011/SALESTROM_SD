// In-memory stand-in for Kafka.
//  - Each consumer group has its own durable, ordered queue (like a partition).
//  - A failing handler is retried with exponential backoff; the queue is blocked
//    meanwhile, so per-key ordering is preserved (CheckoutStarted before PaymentSucceeded).
//  - After maxAttempts the message goes to a dead-letter queue (DLQ) for reconciliation.
// Messages are never lost when a consumer is down: they wait as "consumer lag".
import { sleep } from './util.js';

export class EventBus {
  constructor({ metrics, tracer }) {
    this.groups = new Map();
    this.metrics = metrics;
    this.tracer = tracer;
    this.dlq = [];
    this.stopped = false;
  }

  subscribe(group, topics, handler, { maxAttempts = 12, baseBackoffMs = 80, maxBackoffMs = 800 } = {}) {
    const g = { group, topics: new Set(topics), handler, queue: [], maxAttempts, baseBackoffMs, maxBackoffMs, running: false, processed: 0, retries: 0 };
    this.groups.set(group, g);
    return g;
  }

  publish(topic, payload) {
    const msg = { topic, payload, attempts: 0 };
    this.metrics.inc(`events.${topic}`);
    for (const g of this.groups.values()) {
      if (g.topics.has(topic)) { g.queue.push({ ...msg }); this.#drain(g); }
    }
  }

  async #drain(g) {
    if (g.running) return;
    g.running = true;
    while (g.queue.length && !this.stopped) {
      const msg = g.queue[0];
      try {
        msg.attempts++;
        await g.handler(msg.topic, msg.payload);
        g.queue.shift();
        g.processed++;
      } catch (err) {
        g.retries++;
        this.metrics.inc('consumer.retries');
        if (msg.attempts >= g.maxAttempts) {
          g.queue.shift();
          this.dlq.push({ group: g.group, msg, error: err.message });
          this.metrics.inc('dlq.messages');
          this.tracer.span(msg.payload.traceId, 'Event bus', `${msg.topic} moved to dead-letter queue after ${msg.attempts} attempts (${err.message})`, 'error');
          this.tracer.tag(msg.payload.traceId, 'DLQ');
        } else {
          const backoff = Math.min(g.maxBackoffMs, g.baseBackoffMs * 2 ** (msg.attempts - 1));
          if (msg.attempts === 1 || msg.attempts % 4 === 0) {
            this.tracer.span(msg.payload.traceId, 'Event bus', `${g.group} could not handle ${msg.topic} (${err.message}); retry ${msg.attempts} in ${backoff} ms`, 'warn');
          }
          this.tracer.tag(msg.payload.traceId, 'CONSUMER_RETRY');
          await sleep(backoff);
        }
      }
    }
    g.running = false;
  }

  // Reconciliation job: re-inject DLQ messages once the consumer is healthy again.
  replayDlq() {
    const items = this.dlq.splice(0);
    for (const { group, msg } of items) {
      const g = this.groups.get(group);
      if (!g) continue;
      g.queue.push({ ...msg, attempts: 0 });
      this.tracer.span(msg.payload.traceId, 'Reconciler', `replayed ${msg.topic} from dead-letter queue`);
      this.#drain(g);
    }
    return items.length;
  }

  backlog() {
    const out = {};
    for (const g of this.groups.values()) out[g.group] = g.queue.length;
    out.dlq = this.dlq.length;
    return out;
  }
  idle() { return [...this.groups.values()].every((g) => g.queue.length === 0) && this.dlq.length === 0; }
}
