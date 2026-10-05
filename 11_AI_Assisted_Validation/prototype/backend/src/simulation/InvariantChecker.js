// Business invariants = the correctness guarantees promised in the requirements.
// "live" checks must hold at every instant; "final" checks must hold once the system settles.
export function checkInvariants(sys, { final = false } = {}) {
  const inv = sys.repo.snapshot();
  const resv = [...sys.reservations.reservations.values()];
  const sold = resv.filter((r) => r.status === 'CONFIRMED' || r.status === 'SOLD').length;
  const keyCounts = new Map();
  for (const r of resv) keyCounts.set(r.idempotencyKey, (keyCounts.get(r.idempotencyKey) || 0) + 1);
  const dupReservations = [...keyCounts.values()].filter((n) => n > 1).length;
  const doubleCharges = sys.gateway.executionsPerKey().filter((n) => n > 1).length;
  const succeededPayments = [...sys.payments.payments.values()].filter((p) => p.status === 'SUCCEEDED');
  const confirmedOrders = [...sys.orders.orders.values()].filter((o) => ['CONFIRMED', 'PROCESSING', 'SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED'].includes(o.status));
  const stuck = resv.filter((r) => ['RESERVED', 'PAYMENT_PENDING', 'CONFIRMED'].includes(r.status)).length;

  const pending = (ok) => (final ? (ok ? 'pass' : 'fail') : (ok ? 'pass' : 'pending'));
  return [
    { id: 'no-oversell', label: 'Units sold never exceed stock', detail: `${sold} sold or confirmed of ${inv.stock}`, status: sold <= inv.stock && sys.reservations.oversold === 0 ? 'pass' : 'fail' },
    { id: 'conservation', label: 'Available + reserved + sold = stock', detail: `${inv.available} + ${inv.reserved} + ${inv.sold} = ${inv.available + inv.reserved + inv.sold}`, status: inv.available + inv.reserved + inv.sold === inv.stock ? 'pass' : 'fail' },
    { id: 'non-negative', label: 'Stock never went negative', detail: `lowest available seen: ${inv.minAvailable}, reserved now: ${inv.reserved}`, status: inv.minAvailable >= 0 && inv.reserved >= 0 ? 'pass' : 'fail' },
    { id: 'one-reservation-per-key', label: 'One reservation per idempotency key', detail: `${dupReservations} keys with duplicates`, status: dupReservations === 0 ? 'pass' : 'fail' },
    { id: 'no-double-charge', label: 'Each payment key charged at most once', detail: `${doubleCharges} double charges, ${sys.gateway.dedupHits} PSP de-duplications`, status: doubleCharges === 0 ? 'pass' : 'fail' },
    { id: 'paid-means-ordered', label: 'Every captured payment has a confirmed order', detail: `${succeededPayments.length} captured, ${confirmedOrders.length} confirmed orders`, status: pending(succeededPayments.length === confirmedOrders.length) },
    { id: 'no-stuck-reservations', label: 'No reservation left hanging', detail: `${stuck} still active`, status: pending(stuck === 0) },
  ];
}
