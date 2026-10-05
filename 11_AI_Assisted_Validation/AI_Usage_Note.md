# 11. AI Usage Note / Prompt Summary

**Tool used:** Claude (Anthropic), via claude.ai.

## What AI was used for

| Artefact | AI role | Team role |
|---|---|---|
| Prototype backend (Node.js simulation engine, tests) | Generated code from our design: strategies, services, event bus, simulator | Reviewed every module against the LLD; ran tests; verified traces match sequence diagrams |
| Dashboard (React) | Generated UI code | Chose what to visualise (unit grid, invariants, funnel, traces); reviewed against demo needs |
| Document drafts (Markdown, Mermaid diagrams, SQL DDL) | Drafted text and diagram syntax | Checked every decision, number and diagram; edited wording |

## What AI did not replace

Per the brief's policy, the following are the team's responsibility and every member must be able to explain them without notes: requirement priorities (guarantees vs targets), service boundaries, the choice of atomic conditional update + gate, the "sweeper never expires PAYMENT_PENDING" rule, sync vs async split, and all trade-offs in the ADRs.

## Prompt summary

1. Uploaded the SALESTORM brief; asked for analysis and a complete project following its deliverables.
2. Chose: simulation dashboard + full blueprint; React + Node.js; light enterprise UI.
3. Iterations: fixed an edge case where a reconciler retry during an open circuit could drop a payment record; moved the Order Service outage earlier so it overlaps payments; reduced log noise; added a delayed-order trace tag.

## How the generated code was validated

* 11 automated tests including a deliberately failing baseline (naive strategy must oversell — proves the tests can catch the bug).
* Invariant checker runs live during every simulation (7 guarantees).
* Manual trace review of each brief scenario against `03_LLD` sequence diagrams.
* Failure-variant runs (gateway outage, naive, optimistic) to check the dashboard reports broken guarantees correctly.

> **Team action before submission:** each member should read one service file end to end and add their name below as reviewer.
>
> | Module | Reviewed by |
> |---|---|
> | inventory/ | |
> | payment/ | |
> | order/ + core/EventBus, Outbox | |
> | simulation/ + frontend | |
