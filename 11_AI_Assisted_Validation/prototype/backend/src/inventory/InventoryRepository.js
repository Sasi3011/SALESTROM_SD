// Repository pattern: the only class that touches the INVENTORY row.
// It simulates a SQL database: every call costs one network round trip (latency),
// and each method maps to one SQL statement shown in the comment above it.
import { sleep, rand, Mutex } from '../core/util.js';

export class InventoryRepository {
  constructor({ productId = 'PRODUCT_X', stock, latency = { min: 1, max: 4 } }) {
    this.stock = stock;
    this.latency = latency;
    this.row = { productId, available: stock, reserved: 0, sold: 0, version: 0 };
    this.rowLock = new Mutex();          // models the row-level lock taken by SELECT ... FOR UPDATE
    this.dbCalls = 0;
    this.minAvailable = stock;
  }

  async #roundTrip() { this.dbCalls++; await sleep(rand(this.latency.min, this.latency.max)); }
  #touch() { this.row.version++; this.minAvailable = Math.min(this.minAvailable, this.row.available); }

  // SELECT available, reserved, sold, version FROM inventory WHERE product_id = ?
  async read() { await this.#roundTrip(); return { ...this.row }; }

  // UPDATE inventory SET available = ?, reserved = ? WHERE product_id = ?      (blind write)
  async write(values) { await this.#roundTrip(); Object.assign(this.row, values); this.#touch(); }

  // UPDATE inventory SET available = ?, reserved = ?, version = version + 1
  //  WHERE product_id = ? AND version = ?                                      (optimistic CAS)
  async compareAndSet(expectedVersion, values) {
    await this.#roundTrip();
    if (this.row.version !== expectedVersion) return false;
    Object.assign(this.row, values); this.#touch();
    return true;
  }

  // UPDATE inventory SET available = available - :qty, reserved = reserved + :qty, version = version + 1
  //  WHERE product_id = ? AND available >= :qty                                (atomic conditional update)
  // The condition is evaluated by the database while it holds the row lock, so
  // check-and-decrement is one indivisible step. Rows affected = 1 means success.
  async conditionalReserve(qty) {
    await this.#roundTrip();
    if (this.row.available < qty) return false;
    this.row.available -= qty; this.row.reserved += qty; this.#touch();
    return true;
  }

  // UPDATE inventory SET available = available + :qty, reserved = reserved - :qty WHERE ...
  async release(qty) { await this.#roundTrip(); this.row.available += qty; this.row.reserved -= qty; this.#touch(); }

  // UPDATE inventory SET reserved = reserved - :qty, sold = sold + :qty WHERE ...
  async commitSale(qty) { await this.#roundTrip(); this.row.reserved -= qty; this.row.sold += qty; this.#touch(); }

  snapshot() { return { ...this.row, stock: this.stock, dbCalls: this.dbCalls, minAvailable: this.minAvailable }; }
}
