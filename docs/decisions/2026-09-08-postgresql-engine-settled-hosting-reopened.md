# PostgreSQL is the engine, settled; where it is hosted is re-opened on cost

- **Status:** accepted (engine) · **open** (hosting) — Teja to rule once priced
- **Date:** 2026-09-08
- **Decided by:** Teja

## Context

On 2026-09-06 Teja chose **RDS PostgreSQL** and a provisioning plan was
written (`docs/deployment/11-rds-provisioning-plan.md`: `db.t4g.micro`,
20 GB gp3, ap-south-1, ≈ $17.95/mo). Nothing was provisioned. On 2026-09-08,
asked whether to develop against local Postgres or provision RDS, Teja
answered: *"i wanna use cloud db only but rds is costing too much, any other
options, what about using a vm small one"*.

Billing reality that frames the cost: the AWS account is on the credit-based
Free Plan — $116.51 expiring 2027-02-27 — with **no** legacy 12-month free
tier, so there is no free `db.t3.micro`. The only budget object,
`Monthly-800INR-Limit` (≈ $9.50/mo), is alert-only; RDS breaches it on day
one.

## Decision

Two decisions, deliberately separated because they have different lifetimes:

1. **Engine: PostgreSQL. Closed.** The data is join-heavy (follows, sessions,
   bookings, availability), `1on1_sb` already proved a Postgres schema for
   this exact product, and the full schema is designed in
   `docs/architecture/01-data-model.md`. Everything the data layer builds —
   migrations, the repository, the atomicity guarantees — depends only on the
   engine, not on who hosts it.
2. **Hosting: undecided, re-opened on cost.** Teja wants the database
   cloud-hosted, not local, and cheaper than RDS. Options under evaluation:
   self-managed Postgres on a small EC2 instance (his suggestion), Aurora
   Serverless v2 at its idle floor, or third-party managed Postgres (Neon,
   Supabase — which *run on* AWS; whether that satisfies "AWS only, no GCP"
   is Teja's ruling to make). A read-only cost recon was dispatched to price
   these in ap-south-1.

## Alternatives considered

- **Provision RDS now anyway.** Rejected by Teja on cost. ≈ $17.95/mo,
  covered by credits until 2027-02-27 and then real money; breaches the
  existing budget alarm immediately.
- **Local-only development, decide hosting at deploy time.** The
  orchestrator's recommendation, because PostgreSQL 18.6 is *already
  installed and running* on the machine (service `postgresql-x64-18`) so the
  install cost was zero. **Rejected by Teja** — he wants cloud. Local
  Postgres survives only as the test target (see
  `2026-09-08-local-postgres-is-test-target-only.md`).
- **Switch to DynamoDB for its genuine Always-Free tier.** Not proposed.
  It re-opens the closed engine decision and discards a 38 KB relational
  schema for data that is joins all the way down.

## Consequences

- The data-layer work (Parcels A/B/C) proceeds unblocked: `pool.js` takes a
  connection string and an SSL posture, so the hosting answer plugs in
  later without touching the repository code.
- `docs/deployment/11-rds-provisioning-plan.md` is now a *candidate*, not
  the plan. Its header still says RDS; Parcel C retitles the architecture
  and deployment READMEs to "PostgreSQL (hosting TBD)".
- Anything with a standing hourly charge stays gated behind Teja's explicit
  go — that includes the EC2 option he himself raised.
- A related open question surfaced by the data-layer blueprint: **the
  backend's compute** also matters, because Lambda's per-container pools
  exhaust a `db.t4g.micro`'s ≈ 112 connections at ≈ 109 concurrent
  invocations. The cheapest coherent shape may be one small EC2 running
  both Postgres and Express. That is recorded as a proposal, not a decision.

## Evidence

- Teja's words, 2026-09-08 ≈ 10:39 IST, in reply to a two-option question.
- Zero databases in the account: `docs/deployment/10-aws-inventory-2026-09-06.md`.
- Billing: handoff doc §9.
- Local Postgres: `Get-Service postgresql-x64-18` → Running; `psql --version`
  → 18.6 (recon 2026-09-08).
- Lambda connection ceiling: RDS `max_connections = LEAST(DBInstanceClassMemory/9531392, 5000)` → ≈ 112 for 1 GiB.
