# Deployment docs — index

Infrastructure, cloud inventory, and deployment topics for the `1on1` project.
One file per topic.

| Doc | Topic | Status |
|---|---|---|
| [10-aws-inventory-2026-09-06.md](10-aws-inventory-2026-09-06.md) | Full AWS account inventory (all 17 regions), the "which database" answer, pause plan for the `1on1_sb` legacy stack, and a naming convention proposal | Current as of 2026-09-06 |
| [11-rds-provisioning-plan.md](11-rds-provisioning-plan.md) | RDS PostgreSQL provisioning — parameters, real costs, public-accessibility recommendation, exact create/teardown commands | **Plan only; nothing created.** Awaiting sign-off |

## Key standing facts

- **AWS account:** `869036202796`, default region `ap-south-1` (Mumbai).
- **`1on1` has no AWS footprint.** Nothing has ever been deployed.
- **Database decided 2026-09-06: RDS PostgreSQL** — see
  [02-technology-stack.md](../02-technology-stack.md) §1 (canonical) and
  [11-rds-provisioning-plan.md](11-rds-provisioning-plan.md).
  **Still not provisioned**; the account holds zero databases.
- ⚠️ **The account is on AWS's credit-based Free Plan, not the legacy 12-month
  free tier.** $116.51 in credits, expiring **2027-02-27**. RDS is not free here
  — budget ~$17.95/mo, which exceeds the existing $9.50 budget alarm.
- **The only AWS resource** is one stopped `t3.micro`
  (`i-06832c2229943e99d`, tagged `oneonone-server`) belonging to the **legacy
  `1on1_sb` Spring Boot stack**, not to `1on1`, despite its name.
- ⚠️ **Its 20 GiB volume has `DeleteOnTermination: true` and no snapshot
  exists.** Terminating the instance destroys the only copy of all `1on1_sb`
  data.
