// Counters + latency samples, the shape you would export to Prometheus.
export class Metrics {
  constructor() { this.counters = {}; this.latencies = {}; }
  inc(name, by = 1) { this.counters[name] = (this.counters[name] || 0) + by; }
  get(name) { return this.counters[name] || 0; }
  observe(name, ms) { (this.latencies[name] ||= []).push(ms); }
}
