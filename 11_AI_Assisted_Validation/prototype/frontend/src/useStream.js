import { useEffect, useState } from 'react';

// Subscribes to the engine's Server-Sent Events stream. Reconnects automatically.
export function useStream() {
  const [snapshot, setSnapshot] = useState(null);
  const [connected, setConnected] = useState(null);
  const [doneCount, setDoneCount] = useState(0);
  useEffect(() => {
    const es = new EventSource('/api/stream');
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.addEventListener('snapshot', (e) => setSnapshot(JSON.parse(e.data)));
    es.addEventListener('done', () => setDoneCount((n) => n + 1));
    return () => es.close();
  }, []);
  return { snapshot, connected, doneCount };
}
