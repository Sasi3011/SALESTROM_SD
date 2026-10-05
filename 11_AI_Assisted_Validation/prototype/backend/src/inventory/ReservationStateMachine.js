// State pattern (table-driven): the only legal moves of an INVENTORY_RESERVATION.
//   RESERVED -> PAYMENT_PENDING -> CONFIRMED -> SOLD
//   RESERVED -> TIMEOUT -> RELEASED                (customer never paid)
//   PAYMENT_PENDING -> PAYMENT_FAILED -> RELEASED  (gateway declined)
//   PAYMENT_PENDING -> RESERVED                    (gateway circuit open, customer may retry)
export const RESERVATION_TRANSITIONS = {
  RESERVED: ['PAYMENT_PENDING', 'TIMEOUT'],
  PAYMENT_PENDING: ['CONFIRMED', 'PAYMENT_FAILED', 'RESERVED'],
  CONFIRMED: ['SOLD'],
  PAYMENT_FAILED: ['RELEASED'],
  TIMEOUT: ['RELEASED'],
  SOLD: [],
  RELEASED: [],
};

export class IllegalTransitionError extends Error {}

export function transition(entity, to, transitions, clockNow) {
  const allowed = transitions[entity.status] || [];
  if (!allowed.includes(to)) throw new IllegalTransitionError(`${entity.status} -> ${to} is not allowed`);
  entity.history.push({ from: entity.status, to, t: clockNow });
  entity.status = to;
}
