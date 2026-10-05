import { useEffect, useState } from 'react';
import { api } from '../api.js';
import ControlPanel from './ControlPanel.jsx';
import UnitGrid from './UnitGrid.jsx';
import Invariants from './Invariants.jsx';
import Pipeline from './Pipeline.jsx';
import LoadBalancerPanel from './LoadBalancerPanel.jsx';
import { InventoryChart, LoadChart } from './Charts.jsx';
import Outcomes from './Outcomes.jsx';
import EventLog from './EventLog.jsx';
import History from './History.jsx';

export default function LiveSale({ snapshot, defaults, doneCount, onOpenTrace }) {
  const [config, setConfig] = useState(null);
  const [error, setError] = useState(null);
  const [runs, setRuns] = useState([]);

  useEffect(() => { if (defaults && !config) setConfig(structuredClone(defaults)); }, [defaults, config]);
  useEffect(() => { api.history().then(setRuns).catch(() => {}); }, [doneCount]);

  const running = !!snapshot?.running;
  const start = async () => {
    setError(null);
    try { await api.start(config); } catch (e) { setError(e.message); }
  };

  return (
    <div className="layout">
      <ControlPanel config={config} setConfig={setConfig} defaults={defaults} running={running} onStart={start} error={error} />
      <div className="stack">
        <div className="row-hero">
          <UnitGrid snapshot={snapshot} stock={config?.stock} />
          <Invariants items={snapshot?.invariants} phase={snapshot?.phase} />
        </div>
        <Pipeline snapshot={snapshot} config={config} />
        <LoadBalancerPanel lb={snapshot?.lb} config={snapshot?.config ?? config} />
        <div className="row-2">
          <InventoryChart timeline={snapshot?.timeline ?? []} />
          <LoadChart timeline={snapshot?.timeline ?? []} />
        </div>
        <div className="row-2">
          <EventLog log={snapshot?.log} onOpenTrace={onOpenTrace} />
          <Outcomes outcomes={snapshot?.outcomes} total={snapshot?.config?.users} />
        </div>
        <History runs={runs} />
      </div>
    </div>
  );
}
