import { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { api, fmt } from '../api.js';

const SCENARIOS = [
  { id: 'purchase', name: 'Successful purchase', desc: 'From Buy now to order confirmation', q: { outcome: 'PURCHASED' }, count: (s) => s.outcomes?.PURCHASED },
  { id: 'failed', name: 'Failed payment', desc: 'Decline releases the unit to stock', q: { outcome: 'PAYMENT_FAILED' }, count: (s) => s.outcomes?.PAYMENT_FAILED },
  { id: 'dup', name: 'Duplicate Buy request', desc: 'Same Idempotency-Key, one reservation', q: { tag: 'DUPLICATE', outcome: 'PURCHASED' }, count: (s) => s.tags?.DUPLICATE },
  { id: 'outage', name: 'Paid, then Order Service down', desc: 'Event waits in the queue, order confirms later', q: { tag: 'ORDER_DELAYED' }, count: (s) => s.tags?.ORDER_DELAYED },
  { id: 'timeout', name: 'Payment timeout', desc: 'Reconciled with the gateway, no second charge', q: { tag: 'RECONCILED' }, count: (s) => s.tags?.RECONCILED },
  { id: 'expired', name: 'Reservation expired', desc: 'Customer never paid, TTL released the unit', q: { outcome: 'EXPIRED' }, count: (s) => s.outcomes?.EXPIRED },
  { id: 'soldout', name: 'Inventory reached zero', desc: 'Rejected in memory, database untouched', q: { outcome: 'SOLD_OUT' }, count: (s) => s.outcomes?.SOLD_OUT },
  { id: 'throttled', name: 'Throttled and retried', desc: 'HTTP 429 with Retry-After at the gateway', q: { tag: 'RATE_LIMITED_RETRY' }, count: (s) => s.tags?.RATE_LIMITED_RETRY },
  { id: 'circuit', name: 'Payment circuit open', desc: 'Failed fast while the gateway was down', q: { tag: 'CIRCUIT_OPEN' }, count: (s) => s.tags?.CIRCUIT_OPEN, optional: true },
];

const OUTCOME_TONE = { PURCHASED: 'ok', SOLD_OUT: 'neutral', PAYMENT_FAILED: 'bad', EXPIRED: 'warn', RATE_LIMITED: 'warn', CONTENTION: 'warn' };
const label = (s) => s.toLowerCase().replaceAll('_', ' ').replace(/^./, (c) => c.toUpperCase());

export default function Tracer({ snapshot, focus, onFocus }) {
  const [scenario, setScenario] = useState(null);
  const [items, setItems] = useState([]);
  const [trace, setTrace] = useState(null);
  const [search, setSearch] = useState('');
  const [error, setError] = useState(null);
  const s = snapshot ?? {};

  useEffect(() => {
    if (!focus) return;
    api.trace(focus).then((t) => { setTrace(t); setError(null); }).catch(() => setError(`No trace found for ${focus}`));
  }, [focus]);

  const pick = async (sc) => {
    setScenario(sc.id);
    const r = await api.traces({ ...sc.q, limit: 40 }).catch(() => ({ items: [] }));
    let list = r.items;
    if (!list.length && sc.q.outcome && sc.q.tag) list = (await api.traces({ tag: sc.q.tag, limit: 40 })).items;
    setItems(list);
    if (list[0]) onFocus(list[0].traceId); else setTrace(null);
  };

  const submit = (e) => { e.preventDefault(); const id = search.trim().toUpperCase(); if (id) { setScenario(null); onFocus(id); } };

  if (!snapshot || snapshot.phase === 'idle') {
    return <div className="panel"><div className="empty"><h3>No sale has run yet</h3>Start a flash sale on the Live sale tab, then trace any customer's journey here.</div></div>;
  }

  return (
    <div className="tracer">
      <section className="panel" aria-label="Demonstration scenarios">
        <div className="panel-head"><h2>Jury scenarios</h2><p>From the practical test case</p></div>
        <div className="panel-body" style={{ display: 'grid', gap: 2 }}>
          {SCENARIOS.filter((sc) => !sc.optional || sc.count(s)).map((sc) => (
            <button key={sc.id} className="scenario" aria-pressed={scenario === sc.id} onClick={() => pick(sc)}>
              <span className="n">{sc.name}</span><span className="c">{fmt(sc.count(s))}</span>
              <span className="d">{sc.desc}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="panel" aria-label="Matching customers">
        <div className="panel-head"><h2>Customers</h2><span className="aside">{items.length ? `${items.length} shown` : ''}</span></div>
        <form className="panel-body" onSubmit={submit} style={{ display: 'flex', gap: 6, paddingBottom: 10 }}>
          <input className="input" placeholder="Customer ID, e.g. C00042" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Customer ID" />
          <button className="btn" type="submit" aria-label="Find customer"><Search size={15} /></button>
        </form>
        <div className="trace-list">
          {!items.length && <div className="empty" style={{ padding: 20 }}>Choose a scenario or search for a customer.</div>}
          {items.map((t) => (
            <button key={t.traceId} className="trace-item" aria-pressed={trace?.traceId === t.traceId} onClick={() => onFocus(t.traceId)}>
              <span>{t.traceId}</span><span className="muted">{fmt(t.end - t.start)} ms</span>
            </button>
          ))}
        </div>
      </section>

      <section className="panel" aria-label="Trace detail">
        {error && <div className="empty"><h3>{error}</h3>Customer IDs run from C00001 upward.</div>}
        {!error && !trace && <div className="empty"><h3>Pick a customer</h3>The full journey across every service appears here, in time order.</div>}
        {!error && trace && (
          <>
            <div className="panel-head">
              <h2>{trace.traceId}</h2>
              <span className={`pill ${OUTCOME_TONE[trace.outcome] ?? 'neutral'}`}>{label(trace.outcome)}</span>
              <span className="aside">{trace.spans.length} spans across {new Set(trace.spans.map((x) => x.service)).size} services</span>
            </div>
            {!!trace.tags.length && <div className="panel-body tag-row" style={{ paddingBottom: 0 }}>{trace.tags.map((g) => <span key={g} className="pill neutral">{label(g)}</span>)}</div>}
            <div className="panel-body">
              <ol className="timeline">
                {trace.spans.map((sp, i) => (
                  <li key={i} className={`tl ${sp.level}`}>
                    <span className="t">{fmt(sp.t)} ms</span>
                    <span className="dot" />
                    <div><div className="svc">{sp.service}</div><div className="m">{sp.message}</div></div>
                  </li>
                ))}
              </ol>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
