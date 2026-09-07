# Architecture docs — index

Design-level documents for the `1on1` keeper stack (Node + Express + React,
RDS PostgreSQL). One file per topic.

| Doc | Topic | Status |
|---|---|---|
| [01-data-model.md](01-data-model.md) | PostgreSQL schema — tables, keys, constraints, index catalogue, booking state machine, and the double-booking race condition | Design only; **no migrations written, no tables created** |

## Related

- Database decision (canonical) → [../02-technology-stack.md](../02-technology-stack.md) §1
- System design → [../03-system-design.md](../03-system-design.md)
- Provisioning plan and cost → [../deployment/11-rds-provisioning-plan.md](../deployment/11-rds-provisioning-plan.md)
- Indexing theory → `../learn/06-database-indexing.md` (owned by peer `1on1-c1`)

## Standing facts

- **Database: RDS PostgreSQL 17**, chosen 2026-09-06. **Not provisioned yet.**
- `01-data-model.md` is the **single source of truth for table and column
  names.** Where `docs/02` §16–§22 still use MongoDB vocabulary, or a learning
  doc uses illustrative names, this file wins.
- The schema is **ported from `1on1_sb`'s Flyway migrations** — a Postgres
  schema already proven against a live database for this product. The data model
  crosses over; the Java, JPA annotations and Flyway runner do not.
- Double-booking is prevented by a Postgres **exclusion constraint**
  (`EXCLUDE USING gist`), which requires the **`btree_gist`** extension as a
  migration prerequisite.
