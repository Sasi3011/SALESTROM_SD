import { fmt } from '../api.js';

function Stage({ name, main, sub, kv = [], state = 'ok', status }) {
  return (
    <div className={`stage ${state}`}>
      <div className="stage-name"><span className="stage-dot" />{name}</div>
      <div className="stage-main">{main}</div>
      <div className="stage-sub">{sub}</div>
      {kv.filter(Boolean).map(([k, v, tone]) => (
        <div className={`stage-kv ${tone ?? ''}`} key={k}><span>{k}</span><b>{v}</b></div>
      ))}
      {status && <div className={`stage-status ${state === 'degraded' ? 'warn' : ''}`}>{status}</div>}
    </div>
  );
}

export default function Pipeline({ snapshot, config }) {
  const p = snapshot?.pipeline ?? {};
  const s = snapshot ?? {};
  const backlog = s.backlog ?? {};
  const busTotal = Object.entries(backlog).filter(([k]) => k !== 'dlq').reduce((a, [, v]) => a + v, 0) + (s.outboxPending ?? 0);
  const gateOn = (s.config ?? config)?.gateEnabled ?? true;
  const breaker = s.breaker ?? 'CLOSED';
  const gwDown = s.flags?.gatewayDown;
  const orderDown = s.flags?.orderDown;

  return (
    <section className="panel" aria-label="Request path">
      <div className="panel-head"><h2>Request path</h2><p>Where each request was admitted, throttled or rejected</p></div>
      <div className="pipeline">
        <Stage name="Customers" main={fmt(p.customers ?? config?.users)} sub="clicked Buy now"
          kv={[['double-clicks', fmt(s.tags?.DUPLICATE)], ['idempotent replays', fmt(p.idempotentReplays)]]} />
        <Stage name="API gateway" main={fmt(p.httpRequests)} sub="requests received"
          kv={[['throttled (429)', fmt(p.rateLimited), p.rateLimited ? 'warn' : ''], ['retried later', fmt(s.tags?.RATE_LIMITED_RETRY)]]} />
        <Stage name="Redis gate" main={gateOn ? fmt(p.gateRejected) : 'Off'} sub={gateOn ? 'rejected in memory' : 'all traffic to database'}
          state={gateOn ? 'ok' : 'degraded'} kv={gateOn ? [['tokens left', fmt(s.gateTokens)]] : []} />
        <Stage name="Inventory DB" main={fmt(p.reserved)} sub="units reserved"
          kv={[['DB attempts', fmt(p.dbAttempts)], ['expired', fmt(p.expired)], ['released', fmt(p.released)],
            p.versionConflicts ? ['version conflicts', fmt(p.versionConflicts), 'warn'] : null,
            p.contention ? ['gave up', fmt(p.contention), 'bad'] : null]} />
        <Stage name="Payment" main={fmt(p.paymentsSucceeded)} sub="payments captured"
          state={gwDown ? 'down' : breaker !== 'CLOSED' ? 'degraded' : 'ok'}
          status={gwDown ? 'Gateway down' : breaker !== 'CLOSED' ? `Circuit ${breaker.replace('_', ' ').toLowerCase()}` : null}
          kv={[['declined', fmt(p.paymentsFailed), p.paymentsFailed ? 'bad' : ''], ['timed out', fmt(p.paymentsUnknown), p.paymentsUnknown ? 'warn' : ''],
            ['reconciled', fmt(p.reconciled)], p.circuitRejected ? ['failed fast', fmt(p.circuitRejected), 'warn'] : null]} />
        <Stage name="Event bus" main={fmt(busTotal)} sub="events waiting"
          kv={[['consumer retries', fmt(p.consumerRetries), p.consumerRetries ? 'warn' : ''], ['dead-lettered', fmt(p.dlq), p.dlq ? 'bad' : '']]} />
        <Stage name="Order" main={fmt(p.ordersConfirmed)} sub="orders confirmed" state={orderDown ? 'down' : 'ok'}
          status={orderDown ? 'Service down, events queued' : null}
          kv={[['cancelled', fmt(p.ordersCancelled)], ['queued for order', fmt(backlog['order-service'])]]} />
        <Stage name="Notification" main={fmt(p.notifications)} sub="messages sent" kv={[]} />
      </div>
    </section>
  );
}
