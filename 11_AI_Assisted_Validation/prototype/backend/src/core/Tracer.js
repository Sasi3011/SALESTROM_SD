// Distributed-tracing stand-in. One trace per customer journey (traceId = customerId).
// Every service appends spans with the same traceId, including async consumers,
// which is what OpenTelemetry context propagation gives you in production.
export class Tracer {
  constructor(clock, onLog) {
    this.clock = clock;
    this.traces = new Map();
    this.onLog = onLog;
  }
  begin(traceId, meta) {
    this.traces.set(traceId, { traceId, ...meta, outcome: 'IN_PROGRESS', tags: new Set(), spans: [] });
  }
  span(traceId, service, message, level = 'info') {
    const t = this.traces.get(traceId);
    const entry = { t: this.clock.now(), service, message, level };
    if (t) t.spans.push(entry);
    this.onLog?.({ ...entry, traceId });
  }
  tag(traceId, tag) { this.traces.get(traceId)?.tags.add(tag); }
  outcome(traceId, outcome) { const t = this.traces.get(traceId); if (t) t.outcome = outcome; }
  get(traceId) {
    const t = this.traces.get(traceId);
    return t ? { ...t, tags: [...t.tags] } : null;
  }
  list({ outcome, tag, limit = 60 } = {}) {
    const out = [];
    for (const t of this.traces.values()) {
      if (outcome && t.outcome !== outcome) continue;
      if (tag && !t.tags.has(tag)) continue;
      out.push({ traceId: t.traceId, outcome: t.outcome, tags: [...t.tags], spans: t.spans.length,
        start: t.spans[0]?.t ?? 0, end: t.spans.at(-1)?.t ?? 0 });
      if (out.length >= limit) break;
    }
    return out;
  }
  summary() {
    const outcomes = {}; const tags = {};
    for (const t of this.traces.values()) {
      outcomes[t.outcome] = (outcomes[t.outcome] || 0) + 1;
      for (const g of t.tags) tags[g] = (tags[g] || 0) + 1;
    }
    return { outcomes, tags };
  }
}
