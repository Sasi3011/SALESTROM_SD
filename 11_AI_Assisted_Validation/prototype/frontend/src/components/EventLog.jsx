import { useEffect, useRef } from 'react';

export default function EventLog({ log, onOpenTrace }) {
  const ref = useRef(null);
  useEffect(() => { const el = ref.current; if (el) el.scrollTop = el.scrollHeight; }, [log]);
  return (
    <section className="panel" aria-label="Live event log">
      <div className="panel-head"><h2>Live event log</h2><p>Select a customer to open the full trace</p></div>
      <div className="log" ref={ref} style={{ marginTop: 10 }}>
        {!log?.length && <div className="empty">Events appear here once the sale opens.</div>}
        {log?.map((e, i) => (
          <div key={i} className={`log-row ${e.level}`}>
            <span className="t">{e.t}</span>
            <span className="svc">{e.service}</span>
            <span className="msg">{e.message}</span>
            <span className="tid">{e.traceId && e.traceId !== 'system'
              ? <button className="btn-link" onClick={() => onOpenTrace(e.traceId)}>{e.traceId}</button> : null}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
