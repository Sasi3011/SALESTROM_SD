import { Network, Server } from 'lucide-react';
import { fmt } from '../api.js';

export const ZONES = ['AZ-a', 'AZ-b', 'AZ-c'];
export const podIds = (podsPerZone = 2) => ZONES.flatMap((z) => Array.from({ length: podsPerZone }, (_, i) => `gw-${z.slice(-1)}${i + 1}`));

// Load balancer state from the snapshot, or an idle placeholder built from the config before the first run.
export function lbView(lb, config) {
  if (lb) return lb;
  const pods = podIds(config?.lb?.podsPerZone).map((id) => ({ id, zone: `AZ-${id[3]}`, healthy: true, inFlight: 0, handled: 0 }));
  return { pods, healthy: pods.length, total: pods.length, zones: ZONES.map((zone) => ({ zone, handled: 0, inFlight: 0 })) };
}

export default function LoadBalancerPanel({ lb, config }) {
  const view = lbView(lb, config);
  const max = Math.max(1, ...view.pods.map((p) => p.handled));
  return (
    <section className="panel" aria-label="Traffic distribution">
      <div className="panel-head"><h2><span className="ph-ico"><Network size={14} /></span>Traffic distribution</h2><p>Least-request routing across gateway pods in 3 zones</p></div>
      <div className="panel-body lb-zones">
        {ZONES.map((zone) => {
          const z = view.zones.find((x) => x.zone === zone);
          return (
            <div className="lb-zone" key={zone}>
              <div className="lb-zone-head"><span>{zone}</span><span className="muted">{fmt(z?.handled)} requests</span></div>
              {view.pods.filter((p) => p.zone === zone).map((p) => (
                <div className={`lb-pod ${p.healthy ? '' : 'down'}`} key={p.id}>
                  <div className="lb-pod-row">
                    <span className="lb-pod-id"><Server size={13} className="lb-pod-ico" aria-hidden="true" />{p.id}<i className={`lb-dot ${p.healthy ? 'ok' : 'bad'}`} aria-label={p.healthy ? 'healthy' : 'unhealthy'} /></span>
                    <span className="lb-pod-n"><b>{fmt(p.handled)}</b> handled · {fmt(p.inFlight)} in flight</span>
                  </div>
                  <div className="bar-track"><div className="bar-fill" style={{ width: `${(p.handled / max) * 100}%` }} /></div>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </section>
  );
}
