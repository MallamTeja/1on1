# 10 — AWS Inventory, Pause Plan & Naming Proposal

**Date of scan:** 2026-09-06
**Account:** `869036202796` (IAM user `Teja_mallam_admin`, created 2026-08-27)
**Scan scope:** all 17 enabled regions, plus global services
**Scan type:** READ-ONLY. Nothing was stopped, modified, or deleted.

---

## 0. Executive summary — the three things that matter

1. **The entire AWS account contains ONE compute resource and ZERO databases.**
   A single `t3.micro` EC2 instance and its 20 GiB root volume. No RDS, no
   Aurora, no DynamoDB, no DocumentDB, no ElastiCache, no S3 bucket, no Lambda,
   no load balancer — in any region.

2. **That one instance belongs to `1on1_sb` (legacy Spring Boot), not to the
   keeper — despite being named `oneonone-server`.** This is precisely the
   naming confusion to fix. Evidence in §3.

3. **It is already stopped** (since 2026-09-04 05:21:43 GMT, user-initiated).
   Teja's request "pause every service of my 1on1sb spring boot proj" is
   **already satisfied**. There is nothing left to pause. The remaining
   decisions are about *data safety* and *naming*, not about pausing.

> ### ⚠️ The one genuinely urgent finding
> The legacy PostgreSQL database lives **on the EC2 instance's own root volume**
> (`vol-0647c4e80fce8db78`). That volume is set **`DeleteOnTermination: true`**
> and there are **zero snapshots and zero AMIs** in the account.
>
> **Terminating that instance permanently destroys the only copy of every byte
> of `1on1_sb` data.** There is no backup anywhere. See §6.

---

## 1. Inventory table — complete account contents

| # | Resource | Identifier | Type / spec | State | Region | Created | Attribution |
|---|----------|-----------|-------------|-------|--------|---------|-------------|
| 1 | EC2 instance | `i-06832c2229943e99d` | `t3.micro`, Ubuntu 24.04 LTS (`ami-07e5ce642bbc48c0d`) | **stopped** | ap-south-1b | 2026-08-27 19:29 UTC | **`1on1_sb`** |
| 2 | EBS volume | `vol-0647c4e80fce8db78` | 20 GiB `gp3`, `/dev/sda1`, `DeleteOnTermination: true` | in-use | ap-south-1 | 2026-08-27 19:29 UTC | **`1on1_sb`** |
| 3 | Security group | `sg-01955ea53a5a5a5f8` (`oneonone-sg`) | ingress 22, 80, 443, **8080** — all from `0.0.0.0/0` | active | ap-south-1 | 2026-08-27 | **`1on1_sb`** |
| 4 | Key pair | `oneonone-key` | RSA keypair | active | ap-south-1 | 2026-08-27 19:29 UTC | **`1on1_sb`** |
| 5 | VPC | `vpc-05110805ebf83281c` | `172.31.0.0/16`, **default VPC** | active | ap-south-1 | (AWS default) | **shared / AWS default** |
| 6 | Budget | `Monthly-800INR-Limit` | limit $9.50 | active | global | — | shared |

### Confirmed absent — checked and empty in all 17 regions

`RDS instances` · `RDS/Aurora clusters` · `DynamoDB tables` · `DocumentDB
clusters` · `ElastiCache` · `S3 buckets` (zero, account-wide) · `Lambda` ·
`ELB/ALB/NLB` · `ECS` · `EKS` · `Elastic Beanstalk` · `Lightsail` · `Amplify` ·
`API Gateway` (v1 and v2) · `Secrets Manager secrets` · `SSM parameters` ·
`CloudWatch log groups` · `Elastic IPs` · `NAT gateways` · `EBS snapshots` ·
`self-owned AMIs` · `Route 53 hosted zones` · `CloudFront distributions` ·
`ACM certificates` · `custom IAM roles`.

App Runner returned `SubscriptionRequiredException` — the service was never
activated on this account, which is itself proof nothing runs there.

**Total billable resources: 2** (one stopped instance, one attached volume).

---

## 2. THE ANSWER: which AWS database service does `1on1` use?

### **None. No AWS database service exists in this account.**

This resolves the TODO at `docs/02-technology-stack.md` §1 lines 24–26 — but not
in the way the doc anticipated. The doc asks us to "confirm the exact AWS
database service (RDS / Aurora / DynamoDB / DocumentDB)". **The correct answer is
that no such service was ever provisioned.** The phrase "AWS-hosted cloud
database (managed)" in the docs describes an intention, not a deployed resource.

**Evidence, three independent confirmations:**

| Evidence | Finding |
|---|---|
| AWS control plane | `describe-db-instances`, `describe-db-clusters`, `list-tables`, `docdb describe-db-clusters`, `describe-cache-clusters`, `list-buckets` — **all empty in all 17 regions** |
| Cost Explorer (Jul–Aug 2026) | No RDS, DynamoDB, DocumentDB or ElastiCache line item has ever appeared. A managed DB cannot run without generating one |
| `1on1/backend/package.json` | Dependencies are exactly `cors`, `dotenv`, `express`. **No database driver of any kind** — no `pg`, no `mongodb`, no `@aws-sdk/client-dynamodb`. `server.js` exposes only `GET /api/health` |

**Where the legacy data actually lives:** `1on1_sb` ran **PostgreSQL installed
directly on the EC2 instance's own disk** — self-managed, not a managed service.
Confirmed by `1on1_sb/docs/architecture/02-technology-stack.md:72`
("AWS (EC2 `ap-south-1` + Nginx + PostgreSQL)"). So even the old stack never used
a managed AWS database.

**No `.env` files exist** at `.env`, `backend/.env`, `frontend/.env`,
`.env.local`, or `backend/.env.local` in the `1on1` repo — so there is no
connection string to reconcile against. (Nothing secret is recorded in this doc;
no key names were found to report.)

### ➡️ This is a decision, not a discovery

Because nothing exists, **`1on1`'s database cannot be documented — it must be
chosen.** That choice is Teja's and is flagged in §8 as decision #1. Until it is
made, the TODO should be rewritten from *"confirm which service"* to *"choose and
provision a service"*, because the current phrasing implies a resource exists.

---

## 3. Attribution — why the one instance is `1on1_sb`, not `1on1`

The instance is tagged `Name=oneonone-server`, which *reads* like the keeper
project. It is not. `1on1_sb/docs/deployment/06-aws-deployment.md` documents
creating this exact infrastructure, and every identifier matches:

| Attribute | Value found live in AWS | `1on1_sb` deployment doc |
|---|---|---|
| Region | `ap-south-1` | `ap-south-1` (doc title, line 5) |
| VPC | `vpc-05110805ebf83281c` | `vpc-05110805ebf83281c` (line 24) — **exact match** |
| Security group | `oneonone-sg` | `oneonone-sg` (line 40) |
| Ingress ports | 22, 80, 443, **8080** | 22, 80, 443, 8080 (lines 43–46) — **exact match** |
| Key pair | `oneonone-key` | `oneonone-key.pem` (line 55) |
| AMI | Ubuntu 24.04 `hvm-ssd-gp3` | Ubuntu 24.04 gp3 via SSM (lines 60–61) |

Port **8080** is the decisive signal: that is the Spring Boot default. The
Node/Express keeper listens on **5000** (`backend/src/server.js`). Nothing in
`1on1` has ever been deployed to AWS.

**Confidence: high.** No resource is unattributed. `vpc-05110805ebf83281c` is
the AWS-provided *default* VPC — it is shared infrastructure, not project-owned,
and must not be touched.

### The public IP `13.235.82.139` is already gone

- Verified against AWS `ip-ranges.json`: it falls in `13.232.0.0/14`, service
  `EC2`, region `ap-south-1` — consistent with this instance.
- **No Elastic IP is allocated in this account** (`describe-addresses` empty).
  It was therefore an *ephemeral* public IPv4.
- Ephemeral IPs are released back to AWS when an instance stops. The instance
  stopped on 2026-09-04 and now reports `PublicIpAddress: None`.

**Consequences:**

1. **`https://1on1-sb.vercel.app` has had a dead backend since 2026-09-04.**
   Its `vercel.json` rewrites still point at `13.235.82.139:8080`. The static
   frontend loads; every `/api`, `/ws`, `/oauth2` and `/actuator` call fails.
   This is pre-existing — not something the pause plan would cause.
2. **Restarting the instance will assign a different IP.** `vercel.json` and the
   GitHub Actions default `EC2_HOST` (`1on1_sb/.github/workflows/deploy-aws.yml`
   lines 40, 69) would both need editing. Do not assume a restart restores the
   old address.

---

## 4. Cost analysis

**Observed spend, July + August 2026: effectively $0.00.** Cost Explorer shows
every service at zero, with `EC2 - Other` at a rounding artefact of
$0.0000135/month. The account is inside its AWS free-tier/credit window (opened
2026-08-27), and a `Monthly-800INR-Limit` budget ($9.50) is configured.

Once free-tier coverage lapses, list price in `ap-south-1` would be:

| Item | Rate (ap-south-1) | Monthly | Billing now? |
|---|---|---|---|
| `t3.micro` compute | $0.0112/hr | ~$8.18 | ❌ No — instance stopped |
| 20 GiB `gp3` volume | $0.0912/GB-mo | ~$1.82 | ✅ **Yes — always, even stopped** |
| Public IPv4 | $0.005/hr | ~$3.65 | ❌ No — no IP held |
| **Current run-rate** | | **~$1.82/mo** | (masked to ~$0 by free tier) |
| Run-rate if restarted | | ~$13.65/mo | |

**Maximum further saving available from pausing: $0.00** — because everything
pausable is already paused. The only way to reduce the ~$1.82/mo EBS charge is
to delete the volume, which is destructive and is **not recommended** (§6).

---

## 5. Pause plan

**Status: already complete. No action required, and none is proposed.**

| Resource | Desired state | Actual state | Action |
|---|---|---|---|
| `i-06832c2229943e99d` | stopped | **stopped since 2026-09-04 05:21:43 GMT** | **none** |
| `vol-0647c4e80fce8db78` | retained | in-use, attached | **none — retain** |
| `sg-01955ea53a5a5a5f8` | retained | active | **none — free, and deleting it loses the config** |
| `oneonone-key` | retained | active | **none — free, and it is unrecoverable if deleted** |

For reference, had it been running, the reversible command pair would be:

```bash
# PAUSE (reversible)
aws ec2 stop-instances --region ap-south-1 --instance-ids i-06832c2229943e99d

# REVERSE
aws ec2 start-instances --region ap-south-1 --instance-ids i-06832c2229943e99d
```

**Gotchas that apply here:**

- **A stopped EC2 instance still bills for its EBS volume.** ~$1.82/mo at list
  price continues regardless of instance state. Stopping is not zero-cost.
- **Restarting yields a new public IP** (§3). `vercel.json` and
  `deploy-aws.yml` must be updated after any restart.
- **Do not release anything.** No Elastic IP exists to release; the ephemeral
  address is already gone and cannot be reclaimed.
- **RDS's 7-day auto-restart rule does not apply** — there is no RDS instance.
  (Recorded because the briefing asked for it; noting it is moot avoids someone
  hunting for a stopped RDS that does not exist.)
- Stopping the instance takes `1on1-sb.vercel.app`'s backend offline — but this
  **already happened on 2026-09-04**, so nothing new goes dark.

---

## 6. ⚠️ DO NOT PAUSE / DO NOT DELETE

### Never terminate `i-06832c2229943e99d` without taking a snapshot first

`vol-0647c4e80fce8db78` carries `DeleteOnTermination: true`. It holds the
self-managed PostgreSQL data directory — the **only copy** of all `1on1_sb`
application data. The account has **no snapshots and no AMIs**. Termination is
irreversible and total.

If the data has any value, the safe, cheap, non-destructive protection is a
snapshot (~$0.05/GB-mo, and it does not disturb the stopped instance):

```bash
aws ec2 create-snapshot --region ap-south-1 \
  --volume-id vol-0647c4e80fce8db78 \
  --description "1on1_sb legacy PostgreSQL + app state, pre-decommission 2026-09-06"
```

*This is a write operation and has NOT been run.* It is recommended, not done.

### Resources belonging to `1on1` (the keeper)

**None exist.** `1on1` has zero AWS footprint. Nothing to protect, and nothing
in the pause plan can affect it.

### Shared / AWS-managed — leave alone

- `vpc-05110805ebf83281c` — the AWS **default** VPC. Not project-owned.
  Deleting it is disruptive and hard to undo.
- `Monthly-800INR-Limit` budget — a safety net; keep it.

### Out of scope for pausing (non-AWS)

Inventoried for completeness only; **not touched, and not proposed for pausing**
unless Teja says otherwise.

| Platform | Project | URL | State |
|---|---|---|---|
| Vercel | `1on1-sb` | https://1on1-sb.vercel.app | Production Ready, last deploy 9d ago (frontend serves; **backend calls fail** — see §3) |
| Vercel | `1on1` | https://1on1-mallamteja-projects.vercel.app | last deploy 7d ago |
| Vercel | `1on1.m` | https://open1on1.vercel.app | last deploy 2d ago — most recently active |
| Vercel | `1on1mm` | https://1on1-pi.vercel.app | 106d ago |
| Vercel | `connectand1on1` | https://connectand1on1.vercel.app | 107d ago |

Vercel org `mallamteja-projects` (authenticated as `mallamteja`) holds **20+
projects**, of which **five** carry 1on1-family names. That sprawl is a bigger
day-to-day naming hazard than AWS, where only one resource exists — see §7.
Vercel projects on the Hobby tier cost nothing, so there is no financial urgency.

**Render:** no Render CLI or credentials are present on this machine, so no
Render resource could be observed. Unverified either way.

---

## 7. Naming proposal (proposal only — nothing renamed)

The current name `oneonone-server` is the whole problem: it names the *legacy*
box with a *keeper*-sounding name, with no project, environment, or stack marker.

### Convention

```
<project>-<stack>-<env>-<role>
```

- `project` — `oneonone` (spelled out; AWS resource names disallow leading digits
  in several services, so `1on1` is a poor literal prefix)
- `stack` — `node` (keeper) or `sb` (legacy Spring Boot)
- `env` — `prod` · `stg` · `dev`
- `role` — `api` · `web` · `db` · `sg` · `key`

Plus mandatory tags on every resource, which is what actually makes this
searchable — tags are queryable via `resourcegroupstaggingapi`, names are not:

| Tag | Values |
|---|---|
| `Project` | `oneonone` |
| `Stack` | `node` \| `springboot` |
| `Env` | `prod` \| `stg` \| `dev` |
| `Status` | `active` \| `legacy` |
| `Owner` | `teja` |

### Rename map

| Resource | Current | Proposed | Renameable in place? |
|---|---|---|---|
| EC2 instance | `oneonone-server` | `oneonone-sb-prod-api-legacy` | ✅ **Yes** — the `Name` tag is just a tag |
| EBS volume | *(untagged)* | `oneonone-sb-prod-data-legacy` | ✅ Yes — add a `Name` tag |
| Security group | `oneonone-sg` | `oneonone-sb-prod-sg` | ❌ **No.** A security group name is immutable after creation. Requires create-new + reassociate + delete-old — destructive and not worth it for a stopped instance. **Recommend: retag only, leave the name.** |
| Key pair | `oneonone-key` | `oneonone-sb-key` | ❌ **No.** Immutable. Re-creating means a new private key, and **the existing `.pem` would no longer open the box** — a lockout risk. **Recommend: do not touch.** |
| VPC | `vpc-05110805…` | *(unchanged)* | Default VPC — leave alone |

**Practical recommendation:** apply **tags only**. Tags are free, instant,
non-destructive, and fully queryable. Chasing true renames on the security group
and key pair buys cosmetic tidiness at the cost of real lockout and misconfig
risk, on a stopped instance that is being wound down. Not worth it.

For future `1on1` resources, the names to reserve are
`oneonone-node-prod-api`, `oneonone-node-prod-db`, `oneonone-node-prod-sg`.

**Vercel** is where renaming pays off most (five 1on1-ish project names). Suggested:
`1on1-sb` → `oneonone-sb-legacy`; `1on1` / `1on1.m` / `1on1mm` /
`connectand1on1` → consolidate to one `oneonone-web`, archiving the rest. Vercel
project renames change the default `*.vercel.app` subdomain, so any hardcoded
URL must be updated in the same change.

---

## 8. Decisions needed from Teja

1. **Which database should `1on1` use?** Nothing exists, so this must be chosen,
   not discovered. It blocks the data model and every DB reference in the docs.
   Given a Node/Express + Socket.IO chat app with relational-shaped data (users,
   messages, read receipts), **RDS PostgreSQL** is the closest fit and matches
   the SQL experience already built on `1on1_sb`. DynamoDB would be cheaper at
   idle but a poor fit for the relational queries the design implies.
2. **Snapshot the legacy volume before anything else?** ~$1/mo to make
   `1on1_sb`'s data recoverable. Without it, one `terminate-instances` is
   unrecoverable, permanent data loss.
3. **What is the endgame for `i-06832c2229943e99d`?** It is stopped and costs
   ~$1.82/mo in EBS. Options: leave stopped (safest), snapshot then terminate
   (~$0.05/mo, needs decision #2 first), or restart — which requires updating
   `vercel.json` and `deploy-aws.yml` for the new IP.

---

## Appendix — verification commands

Every command below is read-only and was run for this report.

```bash
aws sts get-caller-identity
aws ec2 describe-regions --query 'Regions[].RegionName'
aws ec2 describe-instances --region ap-south-1
aws ec2 describe-volumes  --region ap-south-1
aws ec2 describe-addresses --region ap-south-1
aws ec2 describe-snapshots --region ap-south-1 --owner-ids self
aws ec2 describe-security-groups --region ap-south-1
aws rds describe-db-instances --region <each>
aws rds describe-db-clusters  --region <each>
aws dynamodb list-tables      --region <each>
aws docdb describe-db-clusters --region ap-south-1
aws s3api list-buckets
aws elbv2 describe-load-balancers --region <each>
aws lambda list-functions --region <each>
aws logs describe-log-groups --region <each>
aws secretsmanager list-secrets --region <each>
aws ce get-cost-and-usage --time-period Start=2026-07-01,End=2026-09-06 \
    --granularity MONTHLY --metrics UnblendedCost \
    --group-by Type=DIMENSION,Key=SERVICE
aws resourcegroupstaggingapi get-resources --region ap-south-1
vercel project ls
```

**No mutating command was executed. No secret value, connection string, or
access key appears in this document.**
