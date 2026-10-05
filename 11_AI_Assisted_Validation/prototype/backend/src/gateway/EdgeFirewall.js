// CDN / WAF at the edge: the first hop every customer passes through.
// Bot-scored clients are blocked with HTTP 403 before they cost the origin anything.
// Production: CloudFront/Akamai + WAF managed rules, bot score from TLS fingerprint and behaviour.
import { chance } from '../core/util.js';

export class EdgeFirewall {
  constructor({ botPct = 1, tracer } = {}) {
    this.botPct = botPct; this.tracer = tracer;
    this.received = 0; this.blocked = 0;
  }

  inspect({ traceId } = {}) {
    this.received++;
    if (!chance(this.botPct)) return { allowed: true };
    this.blocked++;
    this.tracer?.span(traceId, 'CDN / WAF', '403 Forbidden: client scored as a bot, blocked at the edge', 'warn');
    return { allowed: false, status: 403, body: { error: 'BOT_DETECTED' } };
  }
}
