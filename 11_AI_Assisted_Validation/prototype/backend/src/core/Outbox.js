// Transactional Outbox.
// In production: the business row change and the outbox row are written in the
// SAME database transaction, and a relay (e.g. Debezium) publishes outbox rows to Kafka.
// Here: Node runs the state change + append synchronously (no await in between),
// which gives the same "both or neither" guarantee; a relay publishes every 40 ms.
export class Outbox {
  constructor(bus, { intervalMs = 40 } = {}) {
    this.bus = bus; this.rows = []; this.seq = 0;
    this.timer = setInterval(() => this.relay(), intervalMs);
  }
  append(topic, payload) {
    this.rows.push({ topic, payload: { eventId: ++this.seq, occurredAt: Date.now(), ...payload } });
  }
  relay() {
    const batch = this.rows.splice(0);
    for (const r of batch) this.bus.publish(r.topic, r.payload);
  }
  pending() { return this.rows.length; }
  stop() { clearInterval(this.timer); this.relay(); }
}
