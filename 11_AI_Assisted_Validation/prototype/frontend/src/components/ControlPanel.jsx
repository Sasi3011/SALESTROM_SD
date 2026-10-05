import { Play, RotateCcw } from 'lucide-react';

const STRATEGIES = [
  { id: 'atomic', label: 'Atomic update (selected)' },
  { id: 'optimistic', label: 'Optimistic versioning' },
  { id: 'pessimistic', label: 'Pessimistic row lock' },
  { id: 'naive', label: 'Naive read-then-write (unsafe)' },
];

function Range({ label, value, onChange, min = 0, max = 100, suffix = '%' }) {
  return (
    <div className="field">
      <label>{label}<span>{value}{suffix}</span></label>
      <input type="range" min={min} max={max} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  );
}

function Toggle({ label, checked, onChange }) {
  return (
    <label className="toggle">{label}<input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} /></label>
  );
}

export default function ControlPanel({ config, setConfig, defaults, running, onStart, error }) {
  if (!config) return <aside className="panel controls"><div className="panel-body muted">Loading scenario…</div></aside>;
  const set = (k, v) => setConfig((c) => ({ ...c, [k]: v }));
  const setNested = (k, kk, v) => setConfig((c) => ({ ...c, [k]: { ...c[k], [kk]: v } }));

  return (
    <aside className="panel controls" aria-label="Scenario settings">
      <div className="panel-head"><h2>Scenario</h2><span className="aside">10× time compression</span></div>
      <div className="panel-body">
        <div className="pair">
          <div className="field"><label htmlFor="users">Customers</label>
            <input id="users" className="input num" type="number" min="1" max="50000" value={config.users} onChange={(e) => set('users', Number(e.target.value))} /></div>
          <div className="field"><label htmlFor="stock">Units in stock</label>
            <input id="stock" className="input num" type="number" min="1" max="1000" value={config.stock} onChange={(e) => set('stock', Number(e.target.value))} /></div>
        </div>
        <div className="field">
          <label htmlFor="strategy">Concurrency control</label>
          <select id="strategy" className="select" value={config.strategy} onChange={(e) => set('strategy', e.target.value)}>
            {STRATEGIES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </div>
        <Toggle label="Redis admission gate" checked={config.gateEnabled} onChange={(v) => set('gateEnabled', v)} />
        {!config.gateEnabled && <p className="hint">With the gate off, every request reaches the database.</p>}

        <div className="group">
          <p className="group-title">Customer behaviour</p>
          <Range label="Payment success" value={config.paymentSuccessPct} onChange={(v) => set('paymentSuccessPct', v)} />
          <Range label="Duplicate clicks" value={config.duplicatePct} max={30} onChange={(v) => set('duplicatePct', v)} />
          <Range label="Abandon after reserving" value={config.abandonPct} max={50} onChange={(v) => set('abandonPct', v)} />
          <Range label="Gateway responses lost" value={config.lostResponsePct} max={30} onChange={(v) => set('lostResponsePct', v)} />
        </div>

        <div className="group">
          <p className="group-title">Failure injection</p>
          <Toggle label="Order Service outage" checked={config.orderOutage.enabled} onChange={(v) => setNested('orderOutage', 'enabled', v)} />
          {config.orderOutage.enabled && (
            <div className="pair">
              <div className="field"><label htmlFor="os">Starts at (ms)</label>
                <input id="os" className="input num" type="number" min="0" value={config.orderOutage.startMs} onChange={(e) => setNested('orderOutage', 'startMs', Number(e.target.value))} /></div>
              <div className="field"><label htmlFor="od">Lasts (ms)</label>
                <input id="od" className="input num" type="number" min="100" value={config.orderOutage.durationMs} onChange={(e) => setNested('orderOutage', 'durationMs', Number(e.target.value))} /></div>
            </div>
          )}
          <Toggle label="Payment gateway outage" checked={config.gatewayOutage.enabled} onChange={(v) => setNested('gatewayOutage', 'enabled', v)} />
          {config.gatewayOutage.enabled && (
            <div className="pair">
              <div className="field"><label htmlFor="gs">Starts at (ms)</label>
                <input id="gs" className="input num" type="number" min="0" value={config.gatewayOutage.startMs} onChange={(e) => setNested('gatewayOutage', 'startMs', Number(e.target.value))} /></div>
              <div className="field"><label htmlFor="gd">Lasts (ms)</label>
                <input id="gd" className="input num" type="number" min="100" value={config.gatewayOutage.durationMs} onChange={(e) => setNested('gatewayOutage', 'durationMs', Number(e.target.value))} /></div>
            </div>
          )}
        </div>

        {error && <p className="hint" style={{ color: 'var(--bad)', marginTop: 0 }}>{error}</p>}
        <button className="btn btn-primary btn-block" onClick={onStart} disabled={running}>
          <Play size={15} /> {running ? 'Sale in progress…' : 'Start flash sale'}
        </button>
        <button className="btn btn-block" style={{ marginTop: 8 }} onClick={() => setConfig(structuredClone(defaults))} disabled={running}>
          <RotateCcw size={14} /> Restore brief test case
        </button>
      </div>
    </aside>
  );
}
