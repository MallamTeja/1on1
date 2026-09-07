# 11 — RDS PostgreSQL Provisioning Plan

**Status: PLAN ONLY. Nothing has been created.** Every command below is written
out but unexecuted. Provisioning is billable and outward-facing and needs Teja's
explicit go-ahead on the parameters in §8.

**Date:** 2026-09-06 · **Account:** `869036202796` · **Decision:** RDS
PostgreSQL, chosen by Teja 2026-09-06.
Prior audit: [10-aws-inventory-2026-09-06.md](10-aws-inventory-2026-09-06.md).

---

## 1. ⚠️ Correction: this account is NOT on the classic 12-month free tier

The working assumption has been "free tier runs 12 months to 2027-08-27, so a
`db.t3.micro` is free". **That is wrong**, and it changes the cost picture
enough that it should be settled before anything is created.

`aws freetier get-account-plan-state` reports, for this account:

| Field | Value |
|---|---|
| `accountPlanType` | **`FREE`** (the credit-based Free Plan) |
| `accountPlanStatus` | `ACTIVE` |
| `accountPlanRemainingCredits` | **$116.51 USD** |
| `accountPlanExpirationDate` | **2027-02-27** |

Two independent confirmations that the legacy free tier does not apply:

1. **Plan type.** The account was opened 2026-08-27, after AWS moved new
   accounts onto the credit-based Free Plan. That plan grants **credits**, not
   the classic per-service allowances.
2. **`get-free-tier-usage` returns only `Always Free` entries** — SQS, SNS, KMS,
   Glue request quotas. There is not a single `12 Months Free` offer on this
   account. A legacy free-tier account would show them.

**What this means in practice:**

- There is **no "750 free hours of `db.t3.micro`"** here. RDS consumes credits
  from the first hour.
- The runway ends **2027-02-27 — about 5.7 months from today**, not
  2027-08-27. That is six months earlier than assumed.
- When credits are exhausted or expire, usage bills at standard rates.

I could not retrieve AWS's public free-tier page to cross-check the plan's
written terms (the fetch returned no usable content, so I discarded it rather
than quote it). The figures above come directly from the account's own billing
API, which is the stronger source anyway.

---

## 2. Cost — real numbers from the AWS Pricing API

Queried live for `ap-south-1`, PostgreSQL, Single-AZ:

| Item | Rate | Monthly (730 h) |
|---|---|---|
| `db.t4g.micro` | **$0.021/hr** | **$15.33** |
| `db.t3.micro` (for comparison) | $0.026/hr | $18.98 |
| `db.t4g.small` (for comparison) | $0.042/hr | $30.66 |
| Storage, 20 GB | **$0.131/GB-mo** | **$2.62** |
| Automated backups ≤ 100% of DB size | free | $0.00 |
| **Recommended total** | | **≈ $17.95/mo** |

**Credit burn:** $17.95/mo against $116.51 remaining ≈ **6.5 months of
runway**, but credits expire at **2027-02-27** (~5.7 months). So the credits
approximately cover the DB until expiry, with a small margin — *provided nothing
else in the account starts consuming them*.

**After 2027-02-27 this becomes ~$17.95/month of real money.** Teja's existing
`Monthly-800INR-Limit` budget is $9.50 — **this DB would breach that budget on
day one once credits stop**. The budget needs raising or the DB needs stopping
when idle. Flagged as decision (e) in §8.

---

## 3. Recommended parameters

| Parameter | Recommendation | Why |
|---|---|---|
| **Region** | `ap-south-1` (Mumbai) | Confirmed. It is the account's only footprint, the CLI default, and physically closest — lowest latency for a developer in India. No reason to split regions. |
| **Engine** | `postgres` | Decided. |
| **Version** | **17.11** | Verified available in `ap-south-1`. PG 18.x (up to 18.6) is also offered, and 18 adds a native `uuidv7()` function — but since we generate UUIDv7 in Node (see the data-model doc), that draw disappears, and 17 is the more battle-tested choice for a first production database. |
| **Instance class** | **`db.t4g.micro`** | Verified orderable. Graviton/ARM: **19% cheaper than `db.t3.micro`** ($0.021 vs $0.026) *and* faster. Postgres is architecture-neutral — nothing in this stack is x86-bound. There is no reason to pick t3 here. |
| **Storage type** | `gp3` | Verified orderable. Baseline 3000 IOPS included; gp2 ties IOPS to volume size, which at 20 GB would be far worse. |
| **Storage size** | **20 GB** | The minimum for Postgres RDS. This schema is metadata-only — no blobs — so 20 GB is years of headroom. |
| **Storage autoscaling** | max 100 GB | Prevents a disk-full outage without allowing runaway cost. |
| **Multi-AZ** | **OFF** | Doubles cost (~$15/mo more) for standby capacity a solo dev project does not need. |
| **Backup retention** | **7 days** | Free up to the DB's own size. Point-in-time recovery for a week costs nothing here — there is no reason to set 0. |
| **Deletion protection** | **ON** | Blocks accidental `delete-db-instance`. Must be explicitly disabled to tear down, which is the point. |
| **Encryption at rest** | ON | Free. No reason not to. |
| **Public accessibility** | **ON, with a hard IP lock** — see §4 | |
| **Master credentials** | Secrets Manager — see §5 | |

---

## 4. `PubliclyAccessible` — the recommendation, and the reasoning

**Recommendation: `--publicly-accessible`, paired with a dedicated security
group that allows port 5432 from Teja's single IP address only, plus forced
SSL.**

This deserves the reasoning spelled out, because "public Postgres" is the
setup that gets people compromised.

**Why not private-only (the textbook answer)?** A private RDS is only reachable
from inside the VPC. Teja develops on a Windows laptop and runs Express on
`localhost:5000`; there is no keeper-owned compute inside the VPC to reach it
from. Making it private would force one of:

- restarting the legacy EC2 box as an SSH bastion — reintroducing the exact
  machine he is winding down, and paying ~$8/mo to run it; or
- a VPN / EC2 Instance Connect Endpoint — more moving parts than this project
  warrants right now.

Private-only would buy real security at the cost of a daily workflow that fights
him, and the usual outcome of that trade is someone opening `0.0.0.0/0` in
frustration at 2am. **The dangerous configuration is not "publicly accessible" —
it is "publicly accessible with an open security group."** The security group is
the actual control, so that is where the strictness goes.

**The conditions are not optional. All four:**

1. **Security group ingress on 5432 from `<your-ip>/32` only.** Never
   `0.0.0.0/0`. Not even briefly.
2. **Forced SSL** via a custom parameter group (`rds.force_ssl=1`), so
   connections cannot silently fall back to plaintext.
3. **A 32-character password generated and held by AWS Secrets Manager** (§5) —
   never typed, never chosen by a human.
4. **Flip to private** the moment the backend runs on AWS compute. This is a
   development-phase decision, not a permanent one.

**The friction to expect:** home broadband IPs rotate. When the connection
starts timing out, the cause is almost always a changed IP, not a broken DB.
Re-point the rule with:

```bash
MYIP=$(curl -s https://checkip.amazonaws.com)
aws ec2 revoke-security-group-ingress --region ap-south-1 \
  --group-id "$RDS_SG_ID" --protocol tcp --port 5432 --cidr "$OLD_IP/32"
aws ec2 authorize-security-group-ingress --region ap-south-1 \
  --group-id "$RDS_SG_ID" --protocol tcp --port 5432 --cidr "${MYIP}/32"
```

---

## 5. Master credentials — mechanism, never a value

**Recommendation: `--manage-master-user-password`.** RDS generates the password,
stores it in AWS Secrets Manager, and rotates it. The password is never
displayed, never typed, never pasted into a terminal, and never lands in shell
history or a dotfile.

- Cost: ~$0.40/mo per secret plus API calls — cheap for removing an entire class
  of mistake.
- Master username: `oneonone_admin`. **Not** `postgres` or `admin`, which are
  the first two guesses in any credential-stuffing script.
- Retrieve the ARN when needed:
  ```bash
  aws rds describe-db-instances --region ap-south-1 \
    --db-instance-identifier oneonone-node-dev-db \
    --query 'DBInstances[0].MasterUserSecret.SecretArn' --output text
  ```

**For the application**, do not use the master user. After provisioning, create a
least-privilege role (`oneonone_app`) that owns the schema but cannot create
databases or roles. The backend reads its connection details from the gitignored
root `.env` under these **key names only**:

```
DATABASE_URL        # postgres://oneonone_app:<pw>@<endpoint>:5432/oneonone?sslmode=require
PGSSLMODE           # require
```

**No password, endpoint, or connection string is recorded in this document or
any other file in the repo.** `.env` must stay gitignored — verify before the
first write.

---

## 6. Provisioning commands — DO NOT RUN WITHOUT SIGN-OFF

There is **no DB subnet group in this account** (`describe-db-subnet-groups`
returns empty), so step 1 is a genuine prerequisite, not boilerplate. The
default VPC has three subnets across `ap-south-1a/b/c`.

```bash
# ---- shared variables -------------------------------------------------------
REGION=ap-south-1
VPC=vpc-05110805ebf83281c
DBID=oneonone-node-dev-db

# ---- 1. DB subnet group (required; none exists) -----------------------------
aws rds create-db-subnet-group --region $REGION \
  --db-subnet-group-name oneonone-db-subnets \
  --db-subnet-group-description "1on1 keeper RDS subnets (default VPC)" \
  --subnet-ids subnet-085a73705349eb414 subnet-020b44149ebc7487f subnet-0335c995f576c1e10 \
  --tags Key=Project,Value=oneonone Key=Stack,Value=node Key=Env,Value=dev

# ---- 2. Dedicated security group (do NOT reuse the legacy oneonone-sg) ------
RDS_SG_ID=$(aws ec2 create-security-group --region $REGION \
  --group-name oneonone-node-dev-db-sg \
  --description "1on1 keeper RDS - single developer IP only" \
  --vpc-id $VPC --query 'GroupId' --output text)

# ---- 3. Ingress: this machine only. NEVER 0.0.0.0/0 ------------------------
MYIP=$(curl -s https://checkip.amazonaws.com)
aws ec2 authorize-security-group-ingress --region $REGION \
  --group-id "$RDS_SG_ID" --protocol tcp --port 5432 --cidr "${MYIP}/32"

# ---- 4. Parameter group forcing SSL ----------------------------------------
aws rds create-db-parameter-group --region $REGION \
  --db-parameter-group-name oneonone-pg17-ssl \
  --db-parameter-group-family postgres17 \
  --description "1on1 keeper - force SSL"

aws rds modify-db-parameter-group --region $REGION \
  --db-parameter-group-name oneonone-pg17-ssl \
  --parameters "ParameterName=rds.force_ssl,ParameterValue=1,ApplyMethod=pending-reboot"

# ---- 5. The instance -------------------------------------------------------
aws rds create-db-instance --region $REGION \
  --db-instance-identifier $DBID \
  --db-name oneonone \
  --engine postgres --engine-version 17.11 \
  --db-instance-class db.t4g.micro \
  --storage-type gp3 --allocated-storage 20 --max-allocated-storage 100 \
  --master-username oneonone_admin \
  --manage-master-user-password \
  --db-subnet-group-name oneonone-db-subnets \
  --vpc-security-group-ids "$RDS_SG_ID" \
  --db-parameter-group-name oneonone-pg17-ssl \
  --backup-retention-period 7 \
  --no-multi-az \
  --publicly-accessible \
  --storage-encrypted \
  --deletion-protection \
  --copy-tags-to-snapshot \
  --tags Key=Project,Value=oneonone Key=Stack,Value=node Key=Env,Value=dev Key=Status,Value=active

# ---- 6. Wait, then read the endpoint (no secrets printed) ------------------
aws rds wait db-instance-available --region $REGION --db-instance-identifier $DBID
aws rds describe-db-instances --region $REGION --db-instance-identifier $DBID \
  --query 'DBInstances[0].{Endpoint:Endpoint.Address,Port:Endpoint.Port,Status:DBInstanceStatus}'
```

Provisioning takes roughly 5–10 minutes.

---

## 7. Reversal and teardown

### Pause (reversible, keeps all data)

```bash
aws rds stop-db-instance  --region ap-south-1 --db-instance-identifier oneonone-node-dev-db
aws rds start-db-instance --region ap-south-1 --db-instance-identifier oneonone-node-dev-db
```

> ⚠️ **RDS auto-restarts a stopped instance after 7 days.** Unlike EC2, stopping
> is not indefinite — AWS restarts it to apply maintenance, and billing resumes
> silently. To stay stopped you must re-stop it weekly. **A stopped RDS instance
> still bills for its storage** (~$2.62/mo), exactly like a stopped EC2 bills for
> EBS.

### Full teardown (destructive — deletion protection must be lifted first)

```bash
# 1. Lift deletion protection (it exists to make this deliberate)
aws rds modify-db-instance --region ap-south-1 \
  --db-instance-identifier oneonone-node-dev-db \
  --no-deletion-protection --apply-immediately

# 2. Delete, TAKING a final snapshot (recommended)
aws rds delete-db-instance --region ap-south-1 \
  --db-instance-identifier oneonone-node-dev-db \
  --final-db-snapshot-identifier oneonone-node-dev-db-final

# 3. Supporting resources, only after the instance is gone
aws rds delete-db-parameter-group --region ap-south-1 --db-parameter-group-name oneonone-pg17-ssl
aws rds delete-db-subnet-group    --region ap-south-1 --db-subnet-group-name oneonone-db-subnets
aws ec2 delete-security-group     --region ap-south-1 --group-id "$RDS_SG_ID"
```

`--skip-final-snapshot` exists and is deliberately **not** written above.

---

## 8. Needs Teja's sign-off before anything is created

| # | Decision | Recommendation |
|---|---|---|
| **a** | **Public accessibility** — the one real security call | **Yes, with 5432 locked to a single `/32` + forced SSL.** Reasoning in §4. Say no and a bastion is required. |
| **b** | Instance class | `db.t4g.micro` — 19% cheaper *and* faster than `db.t3.micro` |
| **c** | Engine version | `17.11` (18.6 available; 17 is the safer default) |
| **d** | Credentials | Secrets Manager via `--manage-master-user-password` (~$0.40/mo) |
| **e** | **Budget conflict** | ~$17.95/mo exceeds the existing $9.50 `Monthly-800INR-Limit`. Raise the budget, or accept stop/start cycling. |
| **f** | **Credit runway** | Credits ($116.51) expire **2027-02-27**, ~5.7 months out — not 2027-08-27. Real billing starts then. |

**Nothing in this document has been executed. No AWS resource was created,
modified, or deleted.**
