import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid, ComposedChart, Bar, Line } from 'recharts';

const axis = { fontSize: 11, fill: '#7b8597' };
const tip = { contentStyle: { borderRadius: 6, border: '1px solid #e1e6ed', fontSize: 12 }, labelFormatter: (t) => `t = ${t} ms` };

export function InventoryChart({ timeline }) {
  return (
    <section className="panel" aria-label="Inventory over time">
      <div className="panel-head"><h2>Inventory over time</h2><p>Stock only moves between states, never disappears</p></div>
      <div className="panel-body" style={{ height: 250 }}>
        <ResponsiveContainer>
          <AreaChart data={timeline} margin={{ top: 6, right: 6, left: -18, bottom: 0 }}>
            <CartesianGrid stroke="#eef1f5" vertical={false} />
            <XAxis dataKey="t" tick={axis} tickLine={false} axisLine={false} unit="ms" minTickGap={40} />
            <YAxis tick={axis} tickLine={false} axisLine={false} allowDecimals={false} />
            <Tooltip {...tip} />
            <Area type="stepAfter" dataKey="sold" name="Sold" stackId="1" stroke="#2b50d6" fill="#2b50d6" fillOpacity={0.85} isAnimationActive={false} />
            <Area type="stepAfter" dataKey="paying" name="Paying" stackId="1" stroke="#7a5af8" fill="#7a5af8" fillOpacity={0.8} isAnimationActive={false} />
            <Area type="stepAfter" dataKey="reserved" name="Reserved" stackId="1" stroke="#f0a830" fill="#f0a830" fillOpacity={0.8} isAnimationActive={false} />
            <Area type="stepAfter" dataKey="available" name="Available" stackId="1" stroke="#cfd6e0" fill="#e9edf3" isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

export function LoadChart({ timeline }) {
  return (
    <section className="panel" aria-label="Traffic and order queue">
      <div className="panel-head"><h2>Traffic and order queue</h2><p>Requests per second and events waiting for orders</p></div>
      <div className="panel-body" style={{ height: 250 }}>
        <ResponsiveContainer>
          <ComposedChart data={timeline} margin={{ top: 6, right: 0, left: -12, bottom: 0 }}>
            <CartesianGrid stroke="#eef1f5" vertical={false} />
            <XAxis dataKey="t" tick={axis} tickLine={false} axisLine={false} unit="ms" minTickGap={40} />
            <YAxis yAxisId="l" tick={axis} tickLine={false} axisLine={false} />
            <YAxis yAxisId="r" orientation="right" tick={axis} tickLine={false} axisLine={false} allowDecimals={false} />
            <Tooltip {...tip} />
            <Bar yAxisId="l" dataKey="rps" name="Requests/sec" fill="#c9d4fb" isAnimationActive={false} />
            <Line yAxisId="r" type="stepAfter" dataKey="orderLag" name="Waiting for Order Service" stroke="#c8334f" strokeWidth={2} dot={false} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
