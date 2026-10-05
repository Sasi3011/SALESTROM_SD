# UML diagrams (PlantUML)

Each diagram lives in the `uml/` folder of the section that uses it, and is embedded at the top of that section's document. Every diagram has three files side by side: `.puml` (editable source), `.png` (for slides/print), `.svg` (sharp at any zoom).

| Brief deliverable | Diagram | File (`.puml` / `.svg` / `.png`) |
|---|---|---|
| Requirements (extra) | Use case diagram | [`01_Requirements/uml/use_case_diagram`](01_Requirements/uml/use_case_diagram.svg) |
| 2 System context | C4 level 1 | [`02_HLD/uml/01_system_context`](02_HLD/uml/01_system_context.svg) |
| 3–4 HLD / container | C4 level 2 | [`02_HLD/uml/02_container_diagram`](02_HLD/uml/02_container_diagram.svg) |
| 5 Component | Inventory & reservation service | [`02_HLD/uml/03_component_inventory`](02_HLD/uml/03_component_inventory.svg) |
| 5 Component | Payment and order services | [`02_HLD/uml/04_component_payment_order`](02_HLD/uml/04_component_payment_order.svg) |
| 6 Deployment | Kubernetes, 3 AZs, DB replication | [`02_HLD/uml/05_deployment_diagram`](02_HLD/uml/05_deployment_diagram.svg) |
| 7 Database / ER | Entities, PK/FK/UNIQUE/CHECK, per-service DBs | [`04_Database/uml/er_diagram`](04_Database/uml/er_diagram.svg) |
| 8 Class | Inventory, payment, order + patterns | [`03_LLD/uml/01_class_diagram`](03_LLD/uml/01_class_diagram.svg) |
| 9 Purchase / reservation sequence | | [`03_LLD/uml/02_sequence_purchase_reservation`](03_LLD/uml/02_sequence_purchase_reservation.svg) |
| 10 Payment sequence | success, decline, timeout, circuit open | [`03_LLD/uml/03_sequence_payment`](03_LLD/uml/03_sequence_payment.svg) |
| 11 Order sequence | Order Service down + recovery | [`03_LLD/uml/04_sequence_order_recovery`](03_LLD/uml/04_sequence_order_recovery.svg) |
| 12 State | Reservation lifecycle | [`03_LLD/uml/05_state_reservation`](03_LLD/uml/05_state_reservation.svg) |
| 12 State | Order lifecycle | [`03_LLD/uml/06_state_order`](03_LLD/uml/06_state_order.svg) |

## Editing and re-rendering

* **VS Code:** install the "PlantUML" extension (jebbs), open a `.puml`, press `Alt+D` to preview, right-click → Export.
* **Online:** paste the source into https://www.plantuml.com/plantuml or https://plantuml-editor.kkeisuke.com.
* **Command line:** `java -jar plantuml.jar -tpng -tsvg */uml/*.puml` (Graphviz needed for class, component, state, use-case and ER diagrams).
* The two C4 diagrams use PlantUML's built-in C4 library (`!include <C4/...>`); no download needed.

## StarUML

StarUML cannot import PlantUML files. If your evaluators require `.mdj` files, redraw from these diagrams in StarUML (the PNGs serve as the exact blueprint: same class names, members, relationships and states), or ask whether PlantUML is acceptable; the brief lists both as recommended tools.
