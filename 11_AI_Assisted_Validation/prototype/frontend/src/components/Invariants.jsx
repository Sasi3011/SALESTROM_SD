import { CheckCircle2, XCircle, CircleDashed, ShieldCheck } from 'lucide-react';

export default function Invariants({ items, phase }) {
  const list = items ?? [];
  const failed = list.filter((i) => i.status === 'fail').length;
  const pending = list.filter((i) => i.status === 'pending').length;
  const state = !list.length ? 'pending' : failed ? 'fail' : pending ? 'pending' : 'pass';
  const text = !list.length ? 'Run a sale to evaluate the guarantees'
    : failed ? `${failed} guarantee${failed > 1 ? 's' : ''} broken`
      : pending ? 'Holding so far, waiting for the system to settle'
        : phase === 'done' ? 'All guarantees held' : 'All guarantees holding';
  return (
    <section className="panel" aria-label="Correctness guarantees">
      <div className="panel-head"><h2><span className="ph-ico"><ShieldCheck size={14} /></span>Correctness guarantees</h2><p>Checked continuously</p></div>
      <div className="panel-body">
        <ul className="inv">
          {list.map((i) => (
            <li key={i.id}>
              {i.status === 'pass' ? <CheckCircle2 size={18} className="ico-pass" aria-label="holds" />
                : i.status === 'fail' ? <XCircle size={18} className="ico-fail" aria-label="broken" />
                  : <CircleDashed size={18} className="ico-pending" aria-label="pending" />}
              <div><div className="t">{i.label}</div><div className="d">{i.detail}</div></div>
            </li>
          ))}
        </ul>
        <div className={`verdict ${state}`}>
          {state === 'pass' ? <CheckCircle2 size={16} /> : state === 'fail' ? <XCircle size={16} /> : <CircleDashed size={16} />} {text}
        </div>
      </div>
    </section>
  );
}
