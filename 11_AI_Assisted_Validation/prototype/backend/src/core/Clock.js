// Simulation clock. Everything reports time relative to the start of the run,
// so traces read like "t=1,204 ms  Inventory  reserved unit".
export class Clock {
  constructor() { this.start = Date.now(); }
  now() { return Date.now() - this.start; }
}
