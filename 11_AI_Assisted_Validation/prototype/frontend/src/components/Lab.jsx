import { useState } from 'react';
import { Play, FlaskConical, ChartColumn, Database, ListChecks } from 'lucide-react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine, Cell } from 'recharts';
import { api, fmt } from '../api.js';

const EXPLAIN = [
  { name: 'Naive', code: 'SELECT; if (available > 0) UPDATE', text: 'Two requests read the same value and both write. Lost updates oversell.' },
  { name: 'Pessimistic', code: 'SELECT … FOR UPDATE', text: 'Correct, but the lock is held across round trips, so 10,000 requests queue in single file.' },
  { name: 'Optimistic', code: 'UPDATE … WHERE version = ?', text: 'Correct, but on one hot row almost every writer loses and retries. Customers give up while units stay unsold.' },
  { name: 'Atomic (selected)', code: 'UPDATE … WHERE available >= 1', text: 'The database checks and decrements in one step. One round trip, no retries. The Redis gate keeps the rest away.' },
];

function verdict(r) {
  if (r.oversold > 0) return <span className="pill bad">Oversold by {fmt(r.oversold)}</span>;
  if (r.successfulReservations < r.stock) return <span className="pill warn">{fmt(r.stock - r.successfulReservations)} units unsold</span>;
  if (r.p99 > 500) return <span className="pill warn">Correct, slow</span>;
  if (r.strategy === 'atomic+gate') return <span className="pill accent">Selected design</span>;
  return <span className="pill ok">Correct</span>;
}
const color = (r) => (r.oversold > 0 ? '#c8334f' : (r.successfulReservations < r.stock || r.p99 > 500) ? '#b26b00' : r.strategy === 'atomic+gate' ? '#2b50d6' : '#12805a');

export default function Lab() {
  const [users, setUsers] = useState(2000);
  const [stock, setStock] = useState(100);
  const [results, setResults] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const run = async () => {
    setBusy(true); setError(null);
    try { setResults((await api.benchmark({ users, stock })).results); } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  return (
    <div className="stack">
      <section className="panel">
        <div className="panel-head"><h2><span className="ph-ico"><FlaskConical size={14} /></span>Which concurrency control protects the last unit?</h2></div>
        <div className="panel-body lab-head">
          <p className="muted" style={{ margin: 0, flex: '1 1 320px', maxWidth: '70ch' }}>
            Every customer fires at one inventory row at the same moment, with no gate in front unless stated. The same row, the same load, four approaches.
          </p>
          <div className="field"><label htmlFor="lu">Customers</label><input id="lu" className="input num" type="number" min="10" max="5000" value={users} onChange={(e) => setUsers(Number(e.target.value))} /></div>
          <div className="field"><label htmlFor="ls">Units</label><input id="ls" className="input num" type="number" min="1" max="1000" value={stock} onChange={(e) => setStock(Number(e.target.value))} /></div>
          <button className="btn btn-primary" onClick={run} disabled={busy}><Play size={15} />{busy ? 'Running all strategies…' : 'Run comparison'}</button>
        </div>
        {error && <p className="panel-body" style={{ color: 'var(--bad)', paddingTop: 0 }}>{error}</p>}
      </section>

      <section className="panel explain">
        {EXPLAIN.map((e) => (<div key={e.name}><h3>{e.name}</h3><p style={{ marginBottom: 8 }}><code>{e.code}</code></p><p>{e.text}</p></div>))}
      </section>

      {results && (
        <>
          <div className="row-2">
            <section className="panel">
              <div className="panel-head"><h2><span className="ph-ico"><ChartColumn size={14} /></span>Successful reservations</h2><p>Dashed line is the real stock</p></div>
              <div className="panel-body" style={{ height: 260 }}>
                <ResponsiveContainer>
                  <BarChart data={results} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                    <CartesianGrid stroke="#eef1f5" vertical={false} />
                    <XAxis dataKey="strategy" tick={{ fontSize: 11, fill: '#7b8597' }} tickLine={false} axisLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: '#7b8597' }} tickLine={false} axisLine={false} />
                    <Tooltip contentStyle={{ borderRadius: 6, fontSize: 12 }} />
                    <ReferenceLine y={stock} stroke="#142033" strokeDasharray="4 4" />
                    <Bar dataKey="successfulReservations" name="Reservations" isAnimationActive={false}>{results.map((r) => <Cell key={r.strategy} fill={color(r)} />)}</Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </section>
            <section className="panel">
              <div className="panel-head"><h2><span className="ph-ico"><Database size={14} /></span>Database calls</h2><p>Load placed on the inventory row (log scale)</p></div>
              <div className="panel-body" style={{ height: 260 }}>
                <ResponsiveContainer>
                  <BarChart data={results} margin={{ top: 10, right: 10, left: -4, bottom: 0 }}>
                    <CartesianGrid stroke="#eef1f5" vertical={false} />
                    <XAxis dataKey="strategy" tick={{ fontSize: 11, fill: '#7b8597' }} tickLine={false} axisLine={false} />
                    <YAxis scale="log" domain={[10, 'auto']} allowDataOverflow tick={{ fontSize: 11, fill: '#7b8597' }} tickLine={false} axisLine={false} />
                    <Tooltip contentStyle={{ borderRadius: 6, fontSize: 12 }} />
                    <Bar dataKey="dbCalls" name="DB calls" isAnimationActive={false}>{results.map((r) => <Cell key={r.strategy} fill={color(r)} />)}</Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </section>
          </div>
          <section className="panel">
            <div className="panel-head"><h2><span className="ph-ico"><ListChecks size={14} /></span>Results</h2><p>{fmt(users)} customers, {fmt(stock)} units</p></div>
            <div className="panel-body table-wrap">
              <table>
                <thead><tr><th>Approach</th><th className="r">Reserved</th><th className="r">Oversold</th><th className="r">Version conflicts</th><th className="r">Gave up</th><th className="r">DB calls</th><th className="r">p50</th><th className="r">p99</th><th>Verdict</th></tr></thead>
                <tbody>
                  {results.map((r) => (
                    <tr key={r.strategy} className={r.strategy === 'atomic+gate' ? 'selected' : ''}>
                      <td><b>{r.strategy}</b></td>
                      <td className="r">{fmt(r.successfulReservations)}</td>
                      <td className="r" style={{ color: r.oversold ? 'var(--bad)' : undefined }}>{fmt(r.oversold)}</td>
                      <td className="r">{fmt(r.versionConflicts)}</td>
                      <td className="r">{fmt(r.contention)}</td>
                      <td className="r">{fmt(r.dbCalls)}</td>
                      <td className="r">{fmt(r.p50)} ms</td>
                      <td className="r">{fmt(r.p99)} ms</td>
                      <td>{verdict(r)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
