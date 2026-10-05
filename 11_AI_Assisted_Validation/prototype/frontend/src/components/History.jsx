import { History as HistoryIcon } from 'lucide-react';
import { fmt } from '../api.js';

export default function History({ runs }) {
  if (!runs?.length) return null;
  return (
    <section className="panel" aria-label="Previous runs">
      <div className="panel-head"><h2><span className="ph-ico"><HistoryIcon size={14} /></span>Previous runs</h2><p>Compare settings across runs</p></div>
      <div className="panel-body table-wrap">
        <table>
          <thead><tr><th>Run</th><th>Control</th><th className="r">Customers</th><th className="r">Stock</th><th className="r">Sold</th><th className="r">DB attempts</th><th className="r">Order retries</th><th>Guarantees</th></tr></thead>
          <tbody>
            {runs.map((r) => {
              const broken = r.invariants.filter((i) => i.status !== 'pass').length;
              return (
                <tr key={r.id}>
                  <td>#{r.id}</td>
                  <td>{r.config.strategy}{r.config.gateEnabled ? ' + gate' : ''}</td>
                  <td className="r">{fmt(r.config.users)}</td>
                  <td className="r">{fmt(r.config.stock)}</td>
                  <td className="r">{fmt(r.outcomes.PURCHASED)}</td>
                  <td className="r">{fmt(r.pipeline.dbAttempts)}</td>
                  <td className="r">{fmt(r.pipeline.consumerRetries)}</td>
                  <td>{broken ? <span className="pill bad">{broken} broken</span> : <span className="pill ok">All held</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
