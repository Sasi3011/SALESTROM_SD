import { fmt } from '../api.js';

const ROWS = [
  ['PURCHASED', 'Purchased', 'var(--u-sold)'],
  ['SOLD_OUT', 'Sold out', 'var(--ink-3)'],
  ['PAYMENT_FAILED', 'Payment declined', 'var(--bad)'],
  ['EXPIRED', 'Reservation expired', 'var(--u-reserved)'],
  ['RATE_LIMITED', 'Rate limited', 'var(--warn)'],
  ['CONTENTION', 'Gave up (conflicts)', 'var(--warn)'],
  ['RESERVED', 'Still in checkout', 'var(--u-paying)'],
];

export default function Outcomes({ outcomes, total }) {
  const o = outcomes ?? {};
  const max = Math.max(1, total || 0);
  return (
    <section className="panel" aria-label="Customer outcomes">
      <div className="panel-head"><h2>Customer outcomes</h2><p>Every customer gets a definite answer</p></div>
      <div className="panel-body bars">
        {ROWS.filter(([k]) => k === 'PURCHASED' || k === 'SOLD_OUT' || o[k]).map(([k, label, color]) => (
          <div className="bar-row" key={k}>
            <span className="lbl">{label}</span>
            <div className="bar-track"><div className="bar-fill" style={{ width: `${o[k] ? Math.max(0.6, (o[k] / max) * 100) : 0}%`, background: color }} /></div>
            <span className="val">{fmt(o[k])}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
