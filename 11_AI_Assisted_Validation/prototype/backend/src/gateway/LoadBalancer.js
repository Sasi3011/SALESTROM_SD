// L7 load balancer in front of the stateless API gateway pods, spread across availability zones.
// Least-request routing (fewest in-flight requests, ties broken round-robin) keeps slow pods from
// piling up work. Health checks pull a dead pod out of rotation; its traffic moves to the others.
export class LoadBalancer {
  constructor({ zones = ['AZ-a', 'AZ-b', 'AZ-c'], podsPerZone = 2, clock, tracer } = {}) {
    Object.assign(this, { zones, clock, tracer });
    this.pods = zones.flatMap((zone) => Array.from({ length: podsPerZone }, (_, i) => ({
      id: `gw-${zone.slice(-1).toLowerCase()}${i + 1}`, zone, healthy: true, inFlight: 0, handled: 0,
    })));
    this.cursor = 0;               // round-robin position for tie-breaks
    this.routedToUnhealthy = 0;    // must stay 0 (checked as a live invariant)
    this.noUpstream = 0;
  }

  #pick() {
    let best = null; let bestIdx = -1;
    for (let k = 0; k < this.pods.length; k++) {
      const idx = (this.cursor + k) % this.pods.length;
      const pod = this.pods[idx];
      if (pod.healthy && (!best || pod.inFlight < best.inFlight)) { best = pod; bestIdx = idx; }
    }
    if (best) this.cursor = (bestIdx + 1) % this.pods.length;
    return best;
  }

  async route(fn, traceId) {
    const pod = this.#pick();
    if (!pod) {
      this.noUpstream++;
      this.tracer?.span(traceId, 'Load balancer', '503: no healthy gateway pod to route to', 'error');
      return { status: 503, body: { error: 'NO_HEALTHY_UPSTREAM' } };
    }
    if (!pod.healthy) this.routedToUnhealthy++;
    if (this.pods.some((p) => !p.healthy)) this.tracer?.tag(traceId, 'REROUTED');
    this.tracer?.span(traceId, 'Load balancer', `routed to ${pod.id} (${pod.zone})`, 'debug');
    pod.inFlight++;
    try { return await fn(pod); } finally { pod.inFlight--; pod.handled++; }
  }

  setHealthy(podId, healthy) {
    const pod = this.pods.find((p) => p.id === podId);
    if (!pod || pod.healthy === healthy) return;
    pod.healthy = healthy;
    if (healthy) this.tracer?.span('system', 'Load balancer', `${podId} recovered, health check added it back to rotation`, 'success');
    else this.tracer?.span('system', 'Load balancer', `${podId} DOWN, health check removed it from rotation`, 'error');
  }

  stats() {
    const zones = this.zones.map((zone) => {
      const pods = this.pods.filter((p) => p.zone === zone);
      return { zone, handled: pods.reduce((a, p) => a + p.handled, 0), inFlight: pods.reduce((a, p) => a + p.inFlight, 0), healthy: pods.filter((p) => p.healthy).length, pods: pods.length };
    });
    return {
      pods: this.pods.map((p) => ({ ...p })), zones,
      healthy: this.pods.filter((p) => p.healthy).length, total: this.pods.length,
      routedToUnhealthy: this.routedToUnhealthy, noUpstream: this.noUpstream,
    };
  }
}
