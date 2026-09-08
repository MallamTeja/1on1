# Hosting settled: AWS Lightsail VPS for Backend + PostgreSQL, Vercel for Frontend

- **Status:** accepted
- **Date:** 2026-09-08
- **Decided by:** Teja, selecting the budget-capped $5.00/mo VPS architecture

## Context

On 2026-09-08, database hosting was re-opened on cost: AWS RDS PostgreSQL (`db.t4g.micro` @ ~$17.95/mo) would breach the account's ₹800/month (~$9.50) budget alarm once the promotional credit expires on 2027-02-27. Furthermore, traffic is low-volume (1-2 users/day), making dedicated multi-service AWS architectures financially wasteful.

Meanwhile, the React + TypeScript frontend is already deployed to Vercel (`mallamteja-projects` org).

## Decision

Adopt a **split hybrid architecture**:
1. **Frontend:** Hosted on **Vercel** (Hobby tier, $0/mo). Proxies `/api/*` requests to the AWS backend via `frontend/vercel.json` rewrites.
2. **Backend + Database:** Co-hosted on a single **AWS Lightsail VPS** (`nano_3_1` / `micro_3_1`, Ubuntu 24.04 LTS) in Mumbai (`ap-south-1`).
   - Runs PostgreSQL 16/17 bound locally to `127.0.0.1:5432` (never exposed to the public internet).
   - Runs the Express 4 backend via PM2 / systemd on `:5000`.
   - Flat cost: $5.00/mo (~₹470 INR/mo), safely within the ₹800/mo budget limit. Includes 20-40 GB SSD, 1-2 TB transfer, and static public IPv4.
3. **Media Storage (Images & Videos):** Stored in **AWS S3** via presigned upload URLs; only URLs and metadata are stored in PostgreSQL. Binary files (`BYTEA`) are strictly prohibited in the database.
4. **CI/CD Quality Gate:** Unified GitHub Actions pipeline (`.github/workflows/ci-cd.yml`) executing all 87 backend tests, typecheck, lint, and route link-checking before deploying to Vercel and AWS.

## Alternatives considered

- **AWS RDS PostgreSQL (`db.t4g.micro` @ ~$17.95/mo):** Covered by $116 credits until Feb 2027, but breaches the ₹800/mo budget afterward and cannot be permanently paused.
- **Raw AWS EC2 (`t4g.micro` @ ~$11.60/mo with IPv4):** More expensive than Lightsail because AWS charges an additional $0.005/hr ($3.65/mo) for public IPv4 addresses on EC2, plus standalone EBS disk and egress bandwidth fees.
- **Aurora Serverless v2 (~$43.80/mo minimum idle floor):** Exorbitant; ruled out immediately.
- **Storing binary images/videos directly in PostgreSQL:** Rejected because storing blobs in `BYTEA` inflates PostgreSQL WAL logs, bloats RAM buffers, and exhausts disk space rapidly.

## Consequences

- Predictable infrastructure spend: flat ~$5.00/mo (~₹470 INR).
- Sub-millisecond latency between Express and PostgreSQL (co-located on `localhost`).
- Zero CORS preflight friction when requests are routed through Vercel's same-origin rewrites.
- Single-box operational duty: database backups handled via automated Lightsail daily snapshots or a simple cron `pg_dump`.

## Evidence

- Lightsail catalog live scan (`ap-south-1`): `nano_3_1` ($5.00/mo) and `micro_3_1` ($7.00/mo) include standard public IPv4 and SSD storage.
- Account remaining credit: $116.38 USD expiring 2027-02-27.
- Working tree: `.github/workflows/ci-cd.yml` and `frontend/vercel.json` established.
