async function call(path, opts = {}) {
  const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...opts });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body;
}
export const api = {
  defaults: () => call('/api/config/defaults'),
  start: (config) => call('/api/simulations', { method: 'POST', body: JSON.stringify(config) }),
  current: () => call('/api/simulations/current'),
  history: () => call('/api/simulations/history'),
  traces: (q) => call(`/api/traces?${new URLSearchParams(q)}`),
  trace: (id) => call(`/api/traces/${encodeURIComponent(id)}`),
  benchmark: (q) => call('/api/benchmarks', { method: 'POST', body: JSON.stringify(q) }),
};

export const fmt = (n) => (n ?? 0).toLocaleString('en-IN');
export const ms = (n) => `${fmt(Math.round(n ?? 0))} ms`;
