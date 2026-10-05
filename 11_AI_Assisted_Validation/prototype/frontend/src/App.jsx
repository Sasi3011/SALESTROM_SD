import { useEffect, useState } from 'react';
import { Activity, Route, FlaskConical } from 'lucide-react';
import { api } from './api.js';
import { useStream } from './useStream.js';
import LiveSale from './components/LiveSale.jsx';
import Tracer from './components/Tracer.jsx';
import Lab from './components/Lab.jsx';

const TABS = [
  { id: 'live', label: 'Live sale', icon: Activity },
  { id: 'trace', label: 'Request tracer', icon: Route },
  { id: 'lab', label: 'Concurrency lab', icon: FlaskConical },
];

export default function App() {
  const [tab, setTab] = useState('live');
  const [defaults, setDefaults] = useState(null);
  const [focusTrace, setFocusTrace] = useState(null);
  const { snapshot, connected, doneCount } = useStream();

  useEffect(() => { api.defaults().then((d) => setDefaults(d.defaults)).catch(() => {}); }, []);

  const openTrace = (id) => { setFocusTrace(id); setTab('trace'); };

  return (
    <>
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 32 32"><path d="M9 24l5-16h4l-5 16z" fill="#fff" /><path d="M17 24l3-9h3l-3 9z" fill="#fff" opacity=".7" /></svg>
          </span>
          SALESTORM <small>Flash-sale control room</small>
        </div>
        <nav className="tabs" role="tablist">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button key={id} role="tab" className="tab" aria-selected={tab === id} onClick={() => setTab(id)}>
              <Icon size={15} /> {label}
            </button>
          ))}
        </nav>
        <div className="topbar-right">
          <span className={`conn ${connected === null ? '' : connected ? 'on' : 'off'}`}>
            <i /> {connected === false ? 'Engine offline: run npm start in backend/' : 'Engine connected'}
          </span>
        </div>
      </header>
      <main className="page">
        {tab === 'live' && <LiveSale snapshot={snapshot} defaults={defaults} doneCount={doneCount} onOpenTrace={openTrace} />}
        {tab === 'trace' && <Tracer snapshot={snapshot} focus={focusTrace} onFocus={setFocusTrace} />}
        {tab === 'lab' && <Lab />}
      </main>
    </>
  );
}
