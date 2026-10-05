# 02.3 Container Diagram (C4 level 2)

Each box is a separately deployable unit or data store. Arrows show protocol and mode.

```mermaid
flowchart TB
    subgraph Client
      WEB[Web app<br/>React SPA]
      MOB[Mobile app]
    end

    subgraph Edge
      CDN[CDN + WAF + waiting room]
      LB[L7 load balancer]
      GW[API gateway<br/>Kong / Envoy]
    end

    subgraph Core["Core services (Kubernetes, stateless pods)"]
      CAT[Catalog svc<br/>Java / Spring Boot]
      CART[Cart svc]
      SALE[Sale svc]
      CHK[Checkout svc]
      INV[Inventory & reservation svc]
      PAY[Payment svc]
      ORD[Order svc]
      FUL[Fulfilment & shipment svc]
      NOT[Notification svc]
      REC[Reconciliation workers<br/>CronJobs]
    end

    subgraph Data
      R[(Redis cluster<br/>gate, idempotency,<br/>cart, rate limits, cache)]
      IDB[(PostgreSQL inventory<br/>primary + sync standby)]
      PDB[(PostgreSQL payment)]
      ODB[(PostgreSQL order + shipment)]
      CDB[(PostgreSQL catalog + read replicas)]
      K{{Kafka cluster<br/>3 brokers, RF=3}}
      CDC[Outbox relay<br/>Debezium]
    end

    subgraph Observability
      OBS[Prometheus, Grafana,<br/>OpenTelemetry, Loki/ELK, Alertmanager]
    end

    WEB & MOB -->|HTTPS| CDN --> LB --> GW
    GW -->|REST| CAT & CART & SALE & CHK & ORD
    CHK -->|gRPC, 300 ms timeout| INV
    CHK -->|gRPC, 3 s timeout| PAY
    INV --> R
    INV -->|SQL| IDB
    PAY -->|SQL| PDB
    PAY -->|HTTPS + Idempotency-Key| PSP[[PSP]]
    ORD -->|SQL| ODB
    CAT --> CDB
    CAT --> R
    CART --> R
    IDB & PDB & ODB -.->|WAL| CDC -.->|publish| K
    K -.->|consume| INV & ORD & FUL & NOT
    REC --> PDB & PSP & K & R & IDB
    Core -.-> OBS
```

| Container | Tech (proposed) | Owns data | Scales by |
|---|---|---|---|
| API gateway | Envoy / Kong | none | pods (HPA on CPU + RPS) |
| Checkout | Spring Boot (prototype: Node.js) | none (stateless orchestrator) | pods |
| Inventory & reservation | Spring Boot | `inventory`, `inventory_reservation`, `outbox` | pods; DB is single writer per SKU |
| Payment | Spring Boot | `payment`, `outbox` | pods |
| Order | Spring Boot | `orders`, `order_item`, `outbox` | pods + Kafka partitions |
| Redis | Redis Cluster 7 | ephemeral: gate tokens, idempotency, carts | shards |
| PostgreSQL | PostgreSQL 16 + Patroni | durable business data | vertical + read replicas; database per service |
| Kafka | Kafka 3.x | event log | partitions |

**Database per service:** no service reads another service's tables. Cross-service data flows through APIs or events, which keeps service boundaries real and lets each database be tuned for its workload.
