// Strategy pattern (+ OCP / LSP): every concurrency-control approach implements the
// same contract, so ReservationService never changes when a strategy is added.
//
//   reserve(repo, qty) -> Promise<{ ok: boolean, reason?: 'SOLD_OUT' | 'CONTENTION', conflicts: number }>
//
export class ReservationStrategy {
  get name() { throw new Error('not implemented'); }
  get description() { return ''; }
  // eslint-disable-next-line no-unused-vars
  async reserve(repo, qty) { throw new Error('not implemented'); }
}
