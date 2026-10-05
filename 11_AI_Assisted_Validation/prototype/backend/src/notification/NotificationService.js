// Observer: subscribes to business events and notifies customers. It never calls back into
// other services, so a slow SMS/email provider cannot slow down checkout (SRP + async).
export class NotificationService {
  constructor({ tracer, metrics }) { this.tracer = tracer; this.metrics = metrics; this.sent = 0; }
  async handle(topic, e) {
    const text = {
      OrderConfirmed: 'Order confirmed email + SMS sent',
      PaymentFailed: 'Payment failed notice sent with retry link',
      ReservationExpired: 'Reservation expired notice sent',
    }[topic];
    if (!text) return;
    this.sent++;
    this.metrics.inc('notification.sent');
    this.tracer.span(e.traceId, 'Notification', text);
  }
}
