# SALESTORM — High-Scale Flash-Sale System Design

**SYSCRAFTERS 2026 · Design-first, AI-assisted system design hackathon**
Team: `TEAM_NAME` · Members: _add names and roles_

> *When thousands of customers compete for limited stock, can your architecture keep every transaction correct?*
> Yes: 10,000 customers, 100 units, 100 sold, 0 oversold, 0 double charges, 100/100 paid orders confirmed through a 30-second Order Service outage. Measured, not claimed (see `11_AI_Assisted_Validation`).

## The design in five sentences

1. Traffic is shed in layers (CDN/WAF → waiting room → gateway rate limit → Redis stock gate), so about 1 % of requests ever reach the inventory database.
2. Overselling is prevented at exactly one point: `UPDATE inventory SET available = available − 1 … WHERE available >= 1`, backed by a `CHECK (available >= 0)` constraint.
3. Reservations hold a unit for 5 minutes; unpaid holds expire and return to stock, but a hold whose payment has started is never expired by the timer.
4. Payments use one idempotency key per reservation at our database and at the gateway; timeouts become UNKNOWN and are reconciled by asking the gateway, never by guessing.
5. Everything after a payment is asynchronous through a transactional outbox and Kafka, so an Order Service outage delays order confirmation but never loses a paid order.

## Deliverables index

| # | Deliverable | File |
|---|---|---|
| 1 | Requirements & assumptions | `01_Requirements/Requirements_and_Assumptions.md` |
| 2 | System context diagram | `02_HLD/01_System_Context_Diagram.md` |
| 3 | HLD architecture | `02_HLD/02_HLD_Architecture.md` |
| 4 | Container diagram | `02_HLD/03_Container_Diagram.md` |
| 5 | Component diagram | `02_HLD/04_Component_Diagram.md` |
| 6 | Deployment diagram | `02_HLD/05_Deployment_Diagram.md` |
| 7 | Database / ER diagram | `04_Database/ER_Diagram_and_Database_Design.md`, `04_Database/schema.sql` |
| 8 | Class diagram | `03_LLD/01_Class_Diagram.md` |
| 9 | Purchase / reservation sequence | `03_LLD/02_Sequence_Purchase_Reservation.md` |
| 10 | Payment sequence | `03_LLD/03_Sequence_Payment.md` |
| 11 | Order sequence | `03_LLD/04_Sequence_Order.md` |
| 12 | Order / reservation state diagrams | `03_LLD/05_State_Diagrams.md` |
| 13 | SOLID mapping | `06_SOLID/SOLID_Mapping.md` |
| 14 | Design pattern mapping | `07_Design_Patterns/Design_Pattern_Mapping.md` |
| 15 | API specification (+ events) | `05_API/API_and_Event_Specification.md` |
| 16 | Scalability & reliability design | `08_Scalability_Reliability/Scalability_and_Reliability_Design.md` |
| 17 | Security & observability design | `09_Security_Observability/Security_and_Observability_Design.md` |
| 18 | Architecture decision records | `10_ADR/Architecture_Decision_Records.md` |
| 19 | AI-assisted prototype / simulation evidence | `11_AI_Assisted_Validation/prototype/`, `11_AI_Assisted_Validation/Validation_Report.md` |
| 20 | AI usage note / prompt summary | `11_AI_Assisted_Validation/AI_Usage_Note.md` |
| 21 | Final presentation (script + jury prep) | `12_Presentation/Pitch_Script_and_Jury_Prep.md` |

All diagrams are Mermaid. They render directly on GitHub/GitLab, in VS Code (Markdown Preview Mermaid Support) and at mermaid.live; paste into draw.io via *Arrange → Insert → Advanced → Mermaid* if you need editable boxes.

## Run the prototype (≈ 2 minutes)

```bash
cd 11_AI_Assisted_Validation/prototype/backend && npm install && npm test
cd ../frontend && npm install && npm run build
cd ../backend && npm start        # open http://localhost:4000
```

Three tabs: **Live sale** (watch 100 units sell while guarantees are checked live), **Request tracer** (one click per jury scenario), **Concurrency lab** (naive vs pessimistic vs optimistic vs atomic).

## Team ownership (brief §13)

| Role | Owns | Primary files |
|---|---|---|
| System architect | HLD, scalability, deployment | 02, 08 |
| LLD & design engineer | LLD, SOLID, UML, patterns | 03, 06, 07 |
| Data & API engineer | Database, APIs, events | 04, 05 |
| Reliability engineer | Concurrency, failures, security, recovery | 08, 09, 10, 11 |

Every member must be able to answer the final jury question; the rehearsed answer is in `12_Presentation`.
