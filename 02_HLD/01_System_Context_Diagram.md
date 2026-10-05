# 02.1 System Context Diagram (C4 level 1)

SALESTORM is one system. Everything around it is a person or an external system it depends on.

![System context diagram (C4 level 1)](uml/01_system_context.svg)

<sub>PlantUML source: [`uml/01_system_context.puml`](uml/01_system_context.puml) · [PNG](uml/01_system_context.png). The Mermaid version below shows the same diagram as text and renders inline.</sub>

```mermaid
flowchart LR
    C([Customer<br/>web / mobile app])
    A([Sale administrator])
    O([Operations engineer])

    S[["SALESTORM<br/>Flash-sale e-commerce platform<br/><i>catalogue, cart, inventory reservation,<br/>checkout, payment, orders, fulfilment</i>"]]

    IDP[(Identity provider<br/>OAuth 2.0 / OIDC)]
    PSP[(Payment service provider<br/>card / UPI gateway)]
    CR[(Courier partner API)]
    NT[(SMS / email provider)]
    CDN[(CDN + WAF<br/>bot protection)]

    C -- "HTTPS: browse, Buy now, pay, track" --> CDN --> S
    A -- "configure sale, stock, limits" --> S
    O -- "dashboards, alerts, DLQ replay" --> S
    S -- "verify tokens" --> IDP
    S -- "charge / status lookup (idempotency key)" --> PSP
    PSP -- "signed webhooks" --> S
    S -- "create shipment, tracking" --> CR
    S -- "send messages" --> NT
```

| External system | Interaction | Sync / async | Trust |
|---|---|---|---|
| Identity provider | JWT validation (JWKS cached) | Sync, cached | Trusted |
| CDN + WAF | Static content, edge rate limit, bot scoring | Sync | Trusted edge |
| PSP | `charge`, `getStatus`, webhooks | Sync call with timeout + async webhook | Semi-trusted, signature verified |
| Courier partner | Create shipment, tracking callbacks | Async via Fulfilment | Semi-trusted |
| SMS / email | Send notification | Async | Semi-trusted |

**Boundary decision:** card data stays with the PSP (hosted fields / tokens). SALESTORM stores only payment references, which keeps it out of most PCI-DSS scope.
