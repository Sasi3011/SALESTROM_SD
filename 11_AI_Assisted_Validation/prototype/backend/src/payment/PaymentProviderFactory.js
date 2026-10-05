// Factory + OCP: adding a new provider (e.g. a UPI or wallet PSP) is a new Adapter class
// and one registry entry. PaymentService and Checkout are untouched.
import { MockPspAdapter } from './MockPspAdapter.js';

const providers = {
  card: (cfg) => new MockPspAdapter({ name: 'cardpsp', latency: { min: 60, max: 180 }, ...cfg }),
  upi: (cfg) => new MockPspAdapter({ name: 'upipsp', latency: { min: 40, max: 120 }, ...cfg }),
};

export const PaymentProviderFactory = {
  create(method, cfg) {
    const make = providers[method];
    if (!make) throw new Error(`No payment provider for method "${method}"`);
    return make(cfg);
  },
  methods: () => Object.keys(providers),
};
