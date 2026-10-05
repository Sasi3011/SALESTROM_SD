// Models a Redis counter + Lua script in front of the database:
//   if tonumber(redis.call('GET', KEYS[1])) >= qty then return redis.call('DECRBY', KEYS[1], qty) else return -1 end
// Purpose: LOAD SHEDDING, not correctness. Once tokens hit 0, the remaining
// ~9,900 requests are rejected in memory and never reach the database.
// The database guard is still the source of truth (defence in depth): the gate can
// only let MORE requests through to the DB, never cause an oversell.
export class AdmissionGate {
  constructor(stock) { this.tokens = stock; this.rejected = 0; this.admitted = 0; }
  tryAcquire(qty) {
    if (this.tokens >= qty) { this.tokens -= qty; this.admitted++; return true; }
    this.rejected++;
    return false;
  }
  release(qty) { this.tokens += qty; }
}
