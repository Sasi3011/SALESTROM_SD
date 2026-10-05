// Factory pattern: callers ask for a strategy by name (from config) and never
// import concrete classes. Adding a strategy = one new class + one line here.
import { NaiveReadThenWrite } from './NaiveReadThenWrite.js';
import { PessimisticRowLock } from './PessimisticRowLock.js';
import { OptimisticVersioning } from './OptimisticVersioning.js';
import { AtomicConditionalUpdate } from './AtomicConditionalUpdate.js';

const registry = {
  naive: () => new NaiveReadThenWrite(),
  pessimistic: () => new PessimisticRowLock(),
  optimistic: () => new OptimisticVersioning(),
  atomic: () => new AtomicConditionalUpdate(),
};

export const StrategyFactory = {
  create(name) {
    const make = registry[name];
    if (!make) throw new Error(`Unknown reservation strategy "${name}"`);
    return make();
  },
  names: () => Object.keys(registry),
};
