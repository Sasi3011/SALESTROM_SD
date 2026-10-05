import { Route, Users, ShieldCheck, Network, Server, Filter, Database, CreditCard, Workflow, Package, Bell } from 'lucide-react';
import { fmt } from '../api.js';
import { lbView } from './LoadBalancerPanel.jsx';

function Stage({ name, icon: Icon, main, sub, kv = [], state = 'ok', status, children }) {
  return (
    <div className={`stage ${state}`}>
      <div className="stage-name"><span className="stage-ico"><Icon size={14} /></span>{name}</div>
      <div className="stage-main">{main}</div>
      <div className="stage-sub">{sub}</div>
      {kv.filter(Boolean).map(([k, v, tone]) => (
        <div className={`stage-kv ${tone ?? ''}`} key={k}><span>{k}</span><b>{v}</b></div>
      ))}
      {children}
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
  const lb = lbView(s.lb, s.config ?? config);
  const downPods = lb.pods.filter((x) => !x.healthy).map((x) => x.id);
  const zoneMax = Math.max(1, ...lb.zones.map((z) => z.handled));

  return (
    <section className="panel" aria-label="Request path">
      <div className="panel-head"><h2><span className="ph-ico"><Route size={14} /></span>Request path</h2><p>Where each request was admitted, throttled or rejected</p></div>
      <div className="pipeline">
        <Stage name="Customers" icon={Users} main={fmt(p.customers ?? config?.users)} sub="clicked Buy now"
          kv={[['double-clicks', fmt(s.tags?.DUPLICATE)], ['idempotent replays', fmt(p.idempotentReplays)]]} />
        <Stage name="CDN / WAF" icon={ShieldCheck} main={fmt(p.edgeReceived)} sub="requests at edge"
          kv={[['bots blocked', fmt(p.botsBlocked)]]} />
        <Stage name="Load balancer" icon={Network} main={`${lb.healthy} / ${lb.total}`} sub="pods healthy"
          state={downPods.length ? 'degraded' : 'ok'} status={downPods.length ? `${downPods.join(', ')} down, traffic rerouted` : null}>
          <div className="zone-bars">
            {lb.zones.map((z) => (
              <div className="zone-bar" key={z.zone}>
                <span>{z.zone}</span>
                <div className="bar-track"><div className="bar-fill" style={{ width: `${(z.handled / zoneMax) * 100}%` }} /></div>
                <b>{fmt(z.handled)}</b>
              </div>
            ))}
          </div>
        </Stage>
        <Stage name="API gateway" icon={Server} main={fmt(p.httpRequests)} sub="requests received"
          kv={[['throttled (429)', fmt(p.rateLimited), p.rateLimited ? 'warn' : ''], ['retried later', fmt(s.tags?.RATE_LIMITED_RETRY)]]} />
        <Stage name="Redis gate" icon={Filter} main={gateOn ? fmt(p.gateRejected) : 'Off'} sub={gateOn ? 'rejected in memory' : 'all traffic to database'}
          state={gateOn ? 'ok' : 'degraded'} kv={gateOn ? [['tokens left', fmt(s.gateTokens)]] : []} />
        <Stage name="Inventory DB" icon={Database} main={fmt(p.reserved)} sub="units reserved"
          kv={[['DB attempts', fmt(p.dbAttempts)], ['expired', fmt(p.expired)], ['released', fmt(p.released)],
            p.versionConflicts ? ['version conflicts', fmt(p.versionConflicts), 'warn'] : null,
            p.contention ? ['gave up', fmt(p.contention), 'bad'] : null]} />
        <Stage name="Payment" icon={CreditCard} main={fmt(p.paymentsSucceeded)} sub="payments captured"
          state={gwDown ? 'down' : breaker !== 'CLOSED' ? 'degraded' : 'ok'}
          status={gwDown ? 'Gateway down' : breaker !== 'CLOSED' ? `Circuit ${breaker.replace('_', ' ').toLowerCase()}` : null}
          kv={[['declined', fmt(p.paymentsFailed), p.paymentsFailed ? 'bad' : ''], ['timed out', fmt(p.paymentsUnknown), p.paymentsUnknown ? 'warn' : ''],
            ['reconciled', fmt(p.reconciled)], p.circuitRejected ? ['failed fast', fmt(p.circuitRejected), 'warn'] : null]} />
        <Stage name="Event bus" icon={Workflow} main={fmt(busTotal)} sub="events waiting"
          kv={[['consumer retries', fmt(p.consumerRetries), p.consumerRetries ? 'warn' : ''], ['dead-lettered', fmt(p.dlq), p.dlq ? 'bad' : '']]} />
        <Stage name="Order" icon={Package} main={fmt(p.ordersConfirmed)} sub="orders confirmed" state={orderDown ? 'down' : 'ok'}
          status={orderDown ? 'Service down, events queued' : null}
          kv={[['cancelled', fmt(p.ordersCancelled)], ['queued for order', fmt(backlog['order-service'])]]} />
        <Stage name="Notification" icon={Bell} main={fmt(p.notifications)} sub="messages sent" kv={[]} />
      </div>
    </section>
  );
}
