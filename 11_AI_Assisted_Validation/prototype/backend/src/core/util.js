// Small shared helpers. Latency is injected with sleep() so that concurrent
// requests genuinely interleave on the event loop, the same way they would
// interleave across threads/instances hitting a real database.
export const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));
export const rand = (min, max) => min + Math.random() * (max - min);
export const chance = (pct) => Math.random() * 100 < pct;

let seq = 0;
export const newId = (prefix) => `${prefix}_${(++seq).toString(36).padStart(5, '0')}`;

export function percentile(values, p) {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
}

// A simple FIFO mutex, used to model SELECT ... FOR UPDATE (pessimistic row lock).
export class Mutex {
  constructor() { this.queue = []; this.locked = false; }
  async acquire() {
    if (!this.locked) { this.locked = true; return; }
    await new Promise((resolve) => this.queue.push(resolve));
  }
  release() {
    const next = this.queue.shift();
    if (next) next(); else this.locked = false;
  }
}
