import { fmt } from '../api.js';

const LEGEND = [
  { key: 'A', label: 'Available', color: 'var(--u-available)' },
  { key: 'R', label: 'Reserved, waiting for payment', color: 'var(--u-reserved)' },
  { key: 'P', label: 'Payment in progress', color: 'var(--u-paying)' },
  { key: 'C', label: 'Paid, order confirming', color: 'var(--u-confirmed)' },
  { key: 'S', label: 'Sold, order confirmed', color: 'var(--u-sold)' },
];

export default function UnitGrid({ snapshot, stock }) {
  const units = snapshot?.units ?? 'A'.repeat(stock || 100);
  const counts = {};
  for (const ch of units) counts[ch] = (counts[ch] || 0) + 1;
  const n = units.length;
  const cols = Math.min(25, Math.ceil(Math.sqrt(n)));
  const sold = (counts.S || 0) + (counts.C || 0);
  const p = snapshot?.pipeline;
  const phase = snapshot?.phase ?? 'idle';
  const phaseLabel = { idle: 'Ready', burst: 'Sale open', settling: 'Settling queues', done: 'Sale closed' }[phase];

  return (
    <section className="panel" aria-label="Unit inventory">
      <div className="panel-head">
        <h2>Product X inventory</h2>
        <p>Each square is one physical unit</p>
        <span className="aside"><span className={`phase ${phase}`}><span className="pulse" />{phaseLabel}{snapshot ? ` at ${fmt(snapshot.t)} ms` : ''}</span></span>
      </div>
      <div className="hero-body">
        <div className={`unit-grid ${n > 200 ? 'dense' : ''}`} style={{ gridTemplateColumns: `repeat(${cols}, auto)` }} role="img"
          aria-label={`${sold} of ${n} units sold`}>
          {[...units].map((u, i) => <div key={i} className={`unit ${u}`} />)}
        </div>
        <div>
          <div className="hero-figure">{sold}<small> / {n} sold</small></div>
          <p className="hero-caption">
            {p
              ? <>{fmt(p.customers)} customers competed. {fmt(snapshot.outcomes?.SOLD_OUT || 0)} were told it sold out, and only {fmt(p.dbAttempts)} requests ever reached the inventory database.</>
              : 'Start a flash sale to watch customers compete for every unit.'}
          </p>
          <div className="legend">
            {LEGEND.map((l) => (
              <div className="legend-row" key={l.key}>
                <span className="swatch" style={{ background: l.color, borderColor: l.key === 'A' ? undefined : l.color }} />
                {l.label}<b>{counts[l.key] || 0}</b>
              </div>
            ))}
            {snapshot?.oversold > 0 && (
              <div className="legend-row" style={{ color: 'var(--bad)' }}>
                <span className="swatch" style={{ background: 'var(--bad)', borderColor: 'var(--bad)' }} />Oversold (no unit exists)<b style={{ color: 'var(--bad)' }}>{snapshot.oversold}</b>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
