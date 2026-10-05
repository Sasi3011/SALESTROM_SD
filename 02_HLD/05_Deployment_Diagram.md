# 02.5 Deployment Diagram

Single cloud region, three availability zones (AZ-a, AZ-b, AZ-c), managed Kubernetes.

![Deployment diagram: Kubernetes across 3 availability zones](uml/05_deployment_diagram.svg)

<sub>PlantUML source: [`uml/05_deployment_diagram.puml`](uml/05_deployment_diagram.puml) · [PNG](uml/05_deployment_diagram.png). The Mermaid version below shows the same diagram as text and renders inline.</sub>

```mermaid
flowchart TB
    INET([Internet]) --> CDN[Global CDN + WAF<br/>edge PoPs]
    CDN --> ALB[Regional L7 load balancer]

    subgraph Region["Region (e.g. ap-south-1, Mumbai)"]
      ALB
      subgraph K8S["Kubernetes cluster (spread across 3 AZs)"]
        subgraph NSedge["namespace: edge"]
          GW[API gateway<br/>6→60 pods, HPA]
        end
        subgraph NScore["namespace: core"]
          CHK[checkout 4→40]
          INV[inventory 4→20]
          PAY[payment 3→12]
          ORD[order 3→12]
          OTH[catalog, cart, sale,<br/>fulfilment, notification]
          REC[reconciler CronJobs]
        end
        subgraph NSobs["namespace: observability"]
          OBS[OTel collector, Prometheus,<br/>Grafana, Loki]
        end
      end
      subgraph AZa[AZ-a]
        PGP[(PostgreSQL primary<br/>inventory / payment / order)]
        RA[(Redis shard primary)]
        K1{{Kafka broker 1}}
      end
      subgraph AZb[AZ-b]
        PGS[(PostgreSQL sync standby)]
        RB[(Redis replica)]
        K2{{Kafka broker 2}}
      end
      subgraph AZc[AZ-c]
        PGR[(PostgreSQL async read replica)]
        RC[(Redis replica)]
        K3{{Kafka broker 3}}
      end
      VAULT[Secrets manager / KMS]
    end

    ALB --> GW
    GW --> CHK & ORD & OTH
    CHK --> INV & PAY
    INV --> PGP
    PGP -- synchronous replication --> PGS
    PGP -- async --> PGR
    INV --> RA
    RA --> RB & RC
    PAY -->|egress via NAT, allow-listed| PSP[[PSP]]
```

| Element | Configuration | Reason |
|---|---|---|
| Pods | `minReplicas` raised 30 min before sale (pre-warming); HPA on CPU + RPS | Autoscaling is too slow for a 5-second burst; scale before, not during |
| PodDisruptionBudget | ≥ 2 pods of each core service always available | Rolling deploys never take capacity away |
| Topology spread | Pods spread across 3 AZs | Survive an AZ loss |
| PostgreSQL | Patroni, synchronous standby in another AZ, failover < 30 s | RPO 0 for stock and money |
| Redis | Cluster, replica per shard, AOF every second | Ephemeral data; gate can be rebuilt from DB |
| Kafka | 3 brokers, replication factor 3, `min.insync.replicas=2`, `acks=all` | No event loss on one broker failure |
| Network | Private subnets; mTLS via service mesh; only gateway is public | Zero-trust between services |
| Secrets | Vault / cloud KMS, injected at runtime, rotated | No secrets in images or Git |
| Deploy freeze | No deploys from T−2 h to T+1 h of a sale | Change is the top cause of incidents |
