# 01 — PostgreSQL Data Model

**Status:** design document. **No migration files have been written and no
tables have been created** — the database does not exist yet. See
[../deployment/11-rds-provisioning-plan.md](../deployment/11-rds-provisioning-plan.md).

**Database:** RDS PostgreSQL 17, chosen by Teja 2026-09-06.
**Provenance:** ported from `1on1_sb`'s Flyway migrations
(`V1__init.sql` … `V5`), a Postgres schema already exercised against a live
database for this exact product. The *data model* is carried over; the Java is
not. Deviations from that schema are marked **[CHANGED]** with reasons.

This document is the **source of truth for table and column names**. Where
`docs/learn/06-database-indexing.md` uses illustrative names, this file wins.

---

## 1. Scope

Covers the core loop — **Discover → Follow → Engage → Request Session → Meet →
Collaborate → Return/Review**:

| Domain | Tables |
|---|---|
| Identity | `app_user`, `refresh_token` |
| Social graph | `follow` |
| Content / feed | `post`, `comment`, `post_like` |
| Session supply | `session_offering`, `availability_rule`, `availability_exception` |
| Booking | `session_booking`, `booking_preferred_slot`, `booking_participant`, `booking_status_history` |
| Money (simulated) | `payment`, `refund` |
| Collaboration | `conversation`, `conversation_participant`, `message` |
| Reputation | `review` |

Deferred features and the reasoning are in §9.

---

## 2. Conventions

| Concern | Rule |
|---|---|
| Timestamps | **`timestamptz` always.** Never `timestamp`. A naive timestamp silently means a different instant per client, and this product is explicitly multi-timezone (users carry a `timezone` column). |
| Enums | `VARCHAR` + `CHECK (col IN (...))`, **not** native `CREATE TYPE ... AS ENUM`. Adding a value to a PG enum is fine, but removing or reordering one requires rewriting the type. A `CHECK` is edited with a one-line `ALTER`. |
| Soft delete | `deleted_at timestamptz NULL` on user-erasable content only (`post`, `comment`). Everything else deletes for real or is retained by FK. |
| Money | `NUMERIC(12,2)` + `CHAR(3)` currency. **Never `float`.** |
| Naming | `snake_case`; PK `id`; FK `<table>_id`; index `ix_`, unique `uq_`, check `ck_`, exclusion `ex_`. |

---

## 3. Primary keys: UUIDv7 for entities, `bigint` identity for logs

**Recommendation: a hybrid, and it is deliberate.**

### Public-facing entities → `UUID` holding a **UUIDv7**, generated in Node

`app_user`, `post`, `session_booking`, `payment` and friends. Reasoning:

- **`bigserial` is enumerable.** These IDs appear in URLs and API responses.
  Sequential integers let anyone walk `/api/users/1,2,3…` and scrape the user
  table, and they leak absolute business volume — `booking/8417` tells a
  competitor exactly how many bookings exist.
- **UUIDv4 is the wrong fix. [CHANGED]** `1on1_sb` used
  `DEFAULT gen_random_uuid()`, which is **v4 — fully random**. Random keys
  scatter inserts across the whole B-tree: every insert dirties a different
  page, causing page splits, cache churn and inflated WAL. On a `db.t4g.micro`
  with ~1 GB RAM, that is exactly the wrong trade.
- **UUIDv7 is time-ordered** in its high bits, so inserts land on the rightmost
  page like a sequence, while staying non-enumerable. It keeps v4's opacity and
  `bigserial`'s locality.

**Generate in the application**, not the database. PG 18 ships a native
`uuidv7()`, but we are on 17, and generating in Node is better regardless: the
app knows the ID *before* the `INSERT`, so it can build related rows and return
a response without a round-trip. Columns are therefore declared without a
`DEFAULT`:

```sql
id UUID PRIMARY KEY          -- application supplies a UUIDv7
```

### High-volume append-only logs and reference data → `bigint`

`booking_status_history`, `message`, `cancellation_policy`. Never exposed as a
public identifier, written far more often than entities, and 8 bytes beats 16
in both the table and every index. Use the SQL-standard form, not `bigserial`:

```sql
id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY
```

`GENERATED ALWAYS AS IDENTITY` refuses accidental manual inserts into the ID
column and avoids `serial`'s detached-sequence ownership quirks.

---

## 4. Required extensions

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;  -- REQUIRED: scalar = inside GiST exclusions
CREATE EXTENSION IF NOT EXISTS pg_trgm;     -- fuzzy name/company search
CREATE EXTENSION IF NOT EXISTS unaccent;    -- search normalisation
```

**`btree_gist` is a hard prerequisite, not an optimisation.** Without it the
exclusion constraints in §7 cannot be created, and the booking race is
unprotected. It must be the first statement in the first migration.

`pgcrypto` is **[CHANGED] dropped** — it existed only for `gen_random_uuid()`,
which we no longer use.

---

## 5. Identity

```sql
CREATE TABLE app_user (
    id                  UUID PRIMARY KEY,
    username            VARCHAR(40)  NOT NULL,
    email               VARCHAR(255) NOT NULL,
    password_hash       VARCHAR(100),              -- NULL for Google-only accounts
    auth_provider       VARCHAR(16)  NOT NULL DEFAULT 'LOCAL',
    google_subject      VARCHAR(255),              -- Google 'sub' claim; stable per account
    full_name           VARCHAR(120) NOT NULL,
    headline            VARCHAR(200),
    avatar_url          TEXT,
    bio                 TEXT,
    location            VARCHAR(120),
    timezone            VARCHAR(64)  NOT NULL DEFAULT 'Asia/Kolkata',
    is_provider         BOOLEAN      NOT NULL DEFAULT FALSE,
    account_status      VARCHAR(16)  NOT NULL DEFAULT 'ACTIVE',
    rating_avg          NUMERIC(3,2),
    rating_count        INTEGER      NOT NULL DEFAULT 0,
    follower_count      INTEGER      NOT NULL DEFAULT 0,
    following_count     INTEGER      NOT NULL DEFAULT 0,
    last_active_at      TIMESTAMPTZ,
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),

    CONSTRAINT uq_app_user_username   UNIQUE (username),
    CONSTRAINT uq_app_user_google     UNIQUE (google_subject),
    CONSTRAINT ck_app_user_provider   CHECK (auth_provider IN ('LOCAL','GOOGLE')),
    CONSTRAINT ck_app_user_status     CHECK (account_status IN
                                        ('ACTIVE','SUSPENDED','DEACTIVATED','DELETED')),
    -- every account must be reachable by at least one credential
    CONSTRAINT ck_app_user_credential CHECK (password_hash IS NOT NULL
                                             OR google_subject IS NOT NULL),
    CONSTRAINT ck_app_user_rating     CHECK (rating_avg IS NULL
                                             OR rating_avg BETWEEN 1.00 AND 5.00)
);

-- Case-insensitive email uniqueness. [CHANGED]
CREATE UNIQUE INDEX uq_app_user_email_lower ON app_user (LOWER(email));
```

**[CHANGED] — email uniqueness.** `1on1_sb` stored a second
`email_normalized` column and made *that* unique. That works but creates two
sources of truth: any code path that updates `email` without recomputing
`email_normalized` silently breaks uniqueness, and nothing in the database
prevents it. A `LOWER(email)` expression index cannot drift — Postgres
recomputes it on every write. One column, one truth.

`ck_app_user_credential` is what makes email+password and Google-linked accounts
coexist safely: a Google user has no `password_hash`, a local user has no
`google_subject`, and neither can exist with *neither*. A local user who later
links Google simply gains a `google_subject`.

```sql
CREATE TABLE refresh_token (
    id             UUID PRIMARY KEY,
    user_id        UUID        NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    token_hash     CHAR(64)    NOT NULL,       -- SHA-256 hex. NEVER the raw token.
    family_id      UUID        NOT NULL,       -- survives rotation; identifies a login
    issued_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at     TIMESTAMPTZ NOT NULL,
    revoked_at     TIMESTAMPTZ,
    replaced_by_id UUID        REFERENCES refresh_token(id) ON DELETE SET NULL,
    user_agent     TEXT,
    ip_address     INET,

    CONSTRAINT uq_refresh_token_hash   UNIQUE (token_hash),
    CONSTRAINT ck_refresh_token_window CHECK (expires_at > issued_at)
);
```

This is the **rotating, single-use, revocable** contract from `CLAUDE.md`:

- **Single-use:** redeeming a token sets `revoked_at` and points
  `replaced_by_id` at its successor, in one transaction.
- **Rotating:** each refresh mints a new row sharing the `family_id`.
- **Revocable:** logout revokes the row; "log out everywhere" revokes the
  `family_id`.
- **Reuse detection:** presenting an already-revoked token means it was stolen
  and replayed → revoke the entire `family_id`. This is why `family_id` exists
  rather than a flat per-token list.
- Only the **hash** is stored, so a database leak does not yield usable tokens.

---

## 6. Social graph, content, collaboration

```sql
CREATE TABLE follow (
    follower_id  UUID        NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    following_id UUID        NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT pk_follow          PRIMARY KEY (follower_id, following_id),   -- [CHANGED]
    CONSTRAINT ck_follow_not_self CHECK (follower_id <> following_id)
);

-- "who follows me", newest first. NOT a prefix of the PK — both directions needed.
CREATE INDEX ix_follow_reverse ON follow (following_id, created_at DESC);
```

**[CHANGED] — surrogate key removed.** `1on1_sb` gave `follow` a `UUID id` plus a
unique on `(follower_id, following_id)`. The surrogate is dead weight: nothing
references a follow row by ID, and it costs 16 bytes plus an entire extra index.
A composite PK on the natural key is the same constraint, one index cheaper.

```sql
CREATE TABLE post (
    id                UUID PRIMARY KEY,
    author_id         UUID        NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    post_type         VARCHAR(12) NOT NULL,
    body              TEXT,
    link_url          TEXT,
    code_language     VARCHAR(40),
    reposted_post_id  UUID        REFERENCES post(id) ON DELETE SET NULL,
    visibility        VARCHAR(12) NOT NULL DEFAULT 'PUBLIC',
    like_count        INTEGER     NOT NULL DEFAULT 0,
    comment_count     INTEGER     NOT NULL DEFAULT 0,
    published_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at        TIMESTAMPTZ,

    CONSTRAINT ck_post_type       CHECK (post_type IN ('TEXT','IMAGE','LINK','CODE')),
    CONSTRAINT ck_post_visibility CHECK (visibility IN ('PUBLIC','FOLLOWERS','PRIVATE')),
    CONSTRAINT ck_post_link       CHECK (post_type <> 'LINK' OR link_url IS NOT NULL),
    CONSTRAINT ck_post_code       CHECK (post_type <> 'CODE'
                                    OR (body IS NOT NULL AND code_language IS NOT NULL)),
    CONSTRAINT ck_post_no_self_repost CHECK (reposted_post_id IS NULL
                                             OR reposted_post_id <> id)
);

CREATE TABLE comment (
    id                UUID PRIMARY KEY,
    post_id           UUID        NOT NULL REFERENCES post(id)     ON DELETE CASCADE,
    author_id         UUID        NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    parent_comment_id UUID        REFERENCES comment(id) ON DELETE CASCADE,
    body              TEXT        NOT NULL,
    like_count        INTEGER     NOT NULL DEFAULT 0,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at        TIMESTAMPTZ,

    CONSTRAINT ck_comment_self CHECK (parent_comment_id IS NULL
                                      OR parent_comment_id <> id)
);

CREATE TABLE post_like (
    post_id    UUID        NOT NULL REFERENCES post(id)     ON DELETE CASCADE,
    user_id    UUID        NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_post_like PRIMARY KEY (post_id, user_id)   -- one like per user, structurally
);
```

The composite PK on `post_like` makes double-liking **impossible** rather than
merely guarded against — no read-check-write, no race.

**Denormalised counters** (`like_count`, `follower_count`, `rating_avg`) are
kept from `1on1_sb` because recomputing them per feed render is far worse. They
are a real consistency risk: they must be maintained in the *same transaction*
as the row they count, ideally by trigger. Application-level `UPDATE … SET
like_count = like_count + 1` in a separate transaction will drift.

```sql
CREATE TABLE conversation (
    id           UUID PRIMARY KEY,
    booking_id   UUID        REFERENCES session_booking(id) ON DELETE SET NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_message_at TIMESTAMPTZ
);

CREATE TABLE conversation_participant (
    conversation_id UUID        NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
    user_id         UUID        NOT NULL REFERENCES app_user(id)     ON DELETE CASCADE,
    last_read_at    TIMESTAMPTZ,
    CONSTRAINT pk_conversation_participant PRIMARY KEY (conversation_id, user_id)
);

CREATE TABLE message (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    conversation_id UUID        NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
    sender_id       UUID        NOT NULL REFERENCES app_user(id)     ON DELETE CASCADE,
    body            TEXT        NOT NULL,
    delivered_at    TIMESTAMPTZ,
    seen_at         TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

`message` uses `bigint` — highest write volume in the schema, never addressed by
public ID. Sent → Delivered → Seen is modelled as two nullable timestamps rather
than a status enum: it is monotonic, and timestamps record *when*, which a
status column cannot.

---

## 7. Sessions, availability, booking — and the race condition

```sql
CREATE TABLE session_offering (
    id                   UUID PRIMARY KEY,
    provider_id          UUID          NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    title                VARCHAR(160)  NOT NULL,
    description          TEXT,
    format               VARCHAR(12)   NOT NULL,
    duration_minutes     INTEGER       NOT NULL,
    price_amount         NUMERIC(12,2) NOT NULL DEFAULT 0,
    currency             CHAR(3)       NOT NULL DEFAULT 'INR',
    is_free              BOOLEAN       GENERATED ALWAYS AS (price_amount = 0) STORED,
    max_participants     INTEGER       NOT NULL DEFAULT 1,
    min_notice_minutes   INTEGER       NOT NULL DEFAULT 60,
    buffer_after_minutes INTEGER       NOT NULL DEFAULT 0,
    status               VARCHAR(12)   NOT NULL DEFAULT 'DRAFT',
    created_at           TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ   NOT NULL DEFAULT now(),

    CONSTRAINT ck_offering_format     CHECK (format IN ('ONE_ON_ONE','GROUP')),
    CONSTRAINT ck_offering_status     CHECK (status IN ('DRAFT','PUBLISHED','PAUSED','ARCHIVED')),
    CONSTRAINT ck_offering_duration   CHECK (duration_minutes BETWEEN 5 AND 480),
    CONSTRAINT ck_offering_price      CHECK (price_amount >= 0),
    CONSTRAINT ck_offering_capacity   CHECK (max_participants >= 1),
    CONSTRAINT ck_offering_one_on_one CHECK (format = 'GROUP' OR max_participants = 1),
    CONSTRAINT uq_offering_title      UNIQUE (provider_id, title)
);
```

`ck_offering_one_on_one` is a good example of a constraint doing real work: it
makes "a 1-on-1 session with 5 seats" unrepresentable rather than merely
validated in a service method.

### Availability

```sql
CREATE TYPE timerange AS RANGE (subtype = time);   -- PG has no built-in TIME range

CREATE TABLE availability_rule (
    id                    UUID PRIMARY KEY,
    provider_id           UUID        NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    offering_id           UUID        REFERENCES session_offering(id) ON DELETE CASCADE,
    day_of_week           SMALLINT    NOT NULL,
    start_time            TIME        NOT NULL,
    end_time              TIME        NOT NULL,
    timezone              VARCHAR(64) NOT NULL,
    slot_interval_minutes INTEGER     NOT NULL DEFAULT 30,
    effective_from        DATE        NOT NULL DEFAULT CURRENT_DATE,
    effective_until       DATE,
    is_active             BOOLEAN     NOT NULL DEFAULT TRUE,

    CONSTRAINT ck_avail_day      CHECK (day_of_week BETWEEN 1 AND 7),
    CONSTRAINT ck_avail_window   CHECK (end_time > start_time),
    CONSTRAINT ck_avail_interval CHECK (slot_interval_minutes BETWEEN 5 AND 240)
);

-- Two active rules for the same provider/day/scope/timezone may not overlap.
ALTER TABLE availability_rule
    ADD CONSTRAINT ex_avail_no_overlap
    EXCLUDE USING gist (
        provider_id WITH =,
        day_of_week WITH =,
        (COALESCE(offering_id, '00000000-0000-0000-0000-000000000000'::uuid)) WITH =,
        timezone    WITH =,
        timerange(start_time, end_time, '[)') WITH &&
    ) WHERE (is_active);

CREATE TABLE availability_exception (
    id             UUID PRIMARY KEY,
    provider_id    UUID        NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    exception_kind VARCHAR(8)  NOT NULL,
    start_at       TIMESTAMPTZ NOT NULL,
    end_at         TIMESTAMPTZ NOT NULL,
    reason         VARCHAR(200),

    CONSTRAINT ck_avail_exc_kind   CHECK (exception_kind IN ('BLOCKED','EXTRA')),
    CONSTRAINT ck_avail_exc_window CHECK (end_at > start_at)
);

ALTER TABLE availability_exception
    ADD CONSTRAINT ex_avail_exc_no_overlap
    EXCLUDE USING gist (
        provider_id    WITH =,
        exception_kind WITH =,
        tstzrange(start_at, end_at, '[)') WITH &&
    );
```

The `COALESCE(offering_id, '000…0')` trick is needed because `NULL <> NULL` in
an exclusion constraint — two provider-wide rules (both `offering_id IS NULL`)
would otherwise never conflict. Substituting a sentinel UUID makes them compare
equal. Worth understanding before anyone "simplifies" it away.

### Bookings

```sql
CREATE TABLE session_booking (
    id                          UUID PRIMARY KEY,
    offering_id                 UUID          NOT NULL REFERENCES session_offering(id) ON DELETE RESTRICT,
    provider_id                 UUID          NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,
    requester_id                UUID          NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,
    status                      VARCHAR(16)   NOT NULL DEFAULT 'REQUESTED',
    scheduled_start_at          TIMESTAMPTZ   NOT NULL,
    scheduled_end_at            TIMESTAMPTZ   NOT NULL,

    -- snapshots frozen at request time; the offering may change afterwards
    title_snapshot              VARCHAR(160)  NOT NULL,
    duration_minutes            INTEGER       NOT NULL,
    price_amount                NUMERIC(12,2) NOT NULL,
    currency                    CHAR(3)       NOT NULL,
    max_participants            INTEGER       NOT NULL DEFAULT 1,

    seats_taken                 INTEGER       NOT NULL DEFAULT 0,
    requester_note              TEXT,
    provider_note               TEXT,
    meeting_room_code           VARCHAR(32),
    rescheduled_from_booking_id UUID          REFERENCES session_booking(id) ON DELETE SET NULL,

    requested_at                TIMESTAMPTZ   NOT NULL DEFAULT now(),
    accepted_at                 TIMESTAMPTZ,
    started_at                  TIMESTAMPTZ,
    ended_at                    TIMESTAMPTZ,
    cancelled_at                TIMESTAMPTZ,
    created_at                  TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at                  TIMESTAMPTZ   NOT NULL DEFAULT now(),

    CONSTRAINT ck_booking_status CHECK (status IN
        ('REQUESTED','ACCEPTED','REJECTED','RESCHEDULED',
         'CANCELLED','IN_PROGRESS','COMPLETED','NO_SHOW')),
    CONSTRAINT ck_booking_window    CHECK (scheduled_end_at > scheduled_start_at),
    CONSTRAINT ck_booking_not_self  CHECK (provider_id <> requester_id),
    CONSTRAINT ck_booking_price     CHECK (price_amount >= 0),
    CONSTRAINT ck_booking_seats     CHECK (seats_taken >= 0
                                           AND seats_taken <= max_participants),
    CONSTRAINT ck_booking_accepted  CHECK (status <> 'ACCEPTED' OR accepted_at IS NOT NULL),
    CONSTRAINT ck_booking_cancelled CHECK (status <> 'CANCELLED' OR cancelled_at IS NOT NULL),
    CONSTRAINT uq_booking_room      UNIQUE (meeting_room_code)
);
```

The **price and title snapshots** matter: a provider editing their offering must
not retroactively change what an existing booking costs. The booking records
what was agreed.

The **state machine** from `docs/02-technology-stack.md` §20 lives in
`ck_booking_status` (legal values) plus `booking_status_history` (legal
*transitions*, enforced in the service layer and audited):

```
REQUESTED ──► ACCEPTED ──► IN_PROGRESS ──► COMPLETED
    │             │
    │             ├──► RESCHEDULED / CANCELLED / NO_SHOW
    └──► REJECTED
```

```sql
CREATE TABLE booking_status_history (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    booking_id  UUID        NOT NULL REFERENCES session_booking(id) ON DELETE CASCADE,
    from_status VARCHAR(16),                 -- NULL on creation
    to_status   VARCHAR(16) NOT NULL,
    actor_id    UUID        REFERENCES app_user(id) ON DELETE SET NULL,
    actor_role  VARCHAR(10) NOT NULL,
    reason      TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT ck_status_history_actor CHECK (actor_role IN ('REQUESTER','PROVIDER','SYSTEM'))
);
```

`status` shows only the current value; this table is why the history survives.

---

### 7.1 The booking race condition — solved in the schema, not the service

`docs/03-system-design.md` §11 requires an "atomic, transaction-safe
reservation". **A read-then-write check in Express cannot provide that.** Two
concurrent requests both run `SELECT … WHERE slot is free`, both see zero rows,
both `INSERT`. Nothing in default `READ COMMITTED` isolation stops them, and the
window is milliseconds wide — it will happen in production and be unreproducible
in testing.

**Two levels of protection are required, because they catch different bugs.**

**Level 1 — identical-slot duplicates (unique partial index):**

```sql
CREATE UNIQUE INDEX uq_booking_live_request
    ON session_booking (offering_id, requester_id, scheduled_start_at)
    WHERE status IN ('REQUESTED','ACCEPTED','RESCHEDULED','IN_PROGRESS');
```

Stops one user double-submitting the same slot (impatient double-click). It is
**not sufficient** on its own: it only matches *exactly equal* `start_at`
values. A 19:00–20:00 booking and a 19:30–20:30 booking have different start
times, so a unique index sees no conflict — while the provider is very much
double-booked.

**Level 2 — overlapping ranges (exclusion constraint). This is the real fix:**

```sql
-- a provider cannot hold two overlapping live sessions
ALTER TABLE session_booking
    ADD CONSTRAINT ex_booking_provider_no_overlap
    EXCLUDE USING gist (
        provider_id WITH =,
        tstzrange(scheduled_start_at, scheduled_end_at, '[)') WITH &&
    ) WHERE (status IN ('ACCEPTED','RESCHEDULED','IN_PROGRESS'));

-- a requester cannot be in two sessions at once
ALTER TABLE session_booking
    ADD CONSTRAINT ex_booking_requester_no_overlap
    EXCLUDE USING gist (
        requester_id WITH =,
        tstzrange(scheduled_start_at, scheduled_end_at, '[)') WITH &&
    ) WHERE (status IN ('ACCEPTED','RESCHEDULED','IN_PROGRESS'));
```

`&&` is the range-overlap operator; `[)` makes the range half-open so a session
ending at 20:00 does not collide with one starting at 20:00. **Requires the
`btree_gist` extension** (§4) — `provider_id WITH =` is a scalar equality inside
a GiST index, which core GiST cannot do.

Postgres enforces this at commit time under concurrency. The loser gets a
`23P01 exclusion_violation`, which the API maps to **409 Conflict**. No
application locking, no retry loop, no isolation-level upgrade.

**Why not the alternatives?**

| Approach | Verdict |
|---|---|
| `SERIALIZABLE` isolation | Works, but costs serialisation failures across *every* transaction in the app, and needs a retry loop everywhere. Global cost for a local problem. |
| `pg_advisory_xact_lock(provider_id)` | Works, but the guarantee lives in whichever code path remembers to take the lock. A second endpoint, a migration, or a `psql` session bypasses it silently. |
| **Exclusion constraint** | ✅ The guarantee is in the schema. **Nothing** can violate it — not a new endpoint, not a bug, not a manual `INSERT`. |

**A subtlety worth preserving:** the constraint deliberately excludes
`REQUESTED`. Several people *may* request the same slot — that is the product
working as designed, and the provider chooses one. Exclusivity begins at
`ACCEPTED`. Widening the `WHERE` to include `REQUESTED` would break the feature.

**Group sessions** are a different problem — capacity, not overlap. `seats_taken
<= max_participants` is the backstop; the join path must take a row lock so
concurrent joiners serialise:

```sql
BEGIN;
  SELECT seats_taken FROM session_booking WHERE id = $1 FOR UPDATE;
  UPDATE session_booking SET seats_taken = seats_taken + 1 WHERE id = $1;
COMMIT;
```

`FOR UPDATE` is correct *here* because the contended resource is a single
existing row. In the overlap case there is no row to lock yet — which is exactly
why that case needs a constraint instead.

---

## 8. Money (simulated) and reputation

```sql
CREATE TABLE payment (
    id                 UUID PRIMARY KEY,
    booking_id         UUID          NOT NULL REFERENCES session_booking(id) ON DELETE RESTRICT,
    payer_id           UUID          NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,
    payee_id           UUID          NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,
    amount             NUMERIC(12,2) NOT NULL,
    currency           CHAR(3)       NOT NULL DEFAULT 'INR',
    status             VARCHAR(20)   NOT NULL DEFAULT 'PENDING',
    method             VARCHAR(12)   NOT NULL DEFAULT 'MOCK',
    idempotency_key    VARCHAR(80)   NOT NULL,
    refunded_amount    NUMERIC(12,2) NOT NULL DEFAULT 0,
    failure_reason     TEXT,
    paid_at            TIMESTAMPTZ,
    created_at         TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ   NOT NULL DEFAULT now(),

    CONSTRAINT ck_payment_status CHECK (status IN
        ('PENDING','PAID','FAILED','REFUNDED','PARTIALLY_REFUNDED','CANCELLED')),
    CONSTRAINT ck_payment_method  CHECK (method IN ('MOCK')),          -- [CHANGED]
    CONSTRAINT ck_payment_amount  CHECK (amount >= 0),
    CONSTRAINT ck_payment_refund  CHECK (refunded_amount >= 0 AND refunded_amount <= amount),
    CONSTRAINT ck_payment_paid_at CHECK (status <> 'PAID' OR paid_at IS NOT NULL),
    CONSTRAINT ck_payment_parties CHECK (payer_id <> payee_id),
    CONSTRAINT uq_payment_idempotency UNIQUE (idempotency_key)
);

CREATE UNIQUE INDEX uq_payment_live ON payment (booking_id, payer_id)
    WHERE status IN ('PENDING','PAID','PARTIALLY_REFUNDED');

CREATE TABLE refund (
    id           UUID PRIMARY KEY,
    payment_id   UUID          NOT NULL REFERENCES payment(id) ON DELETE RESTRICT,
    amount       NUMERIC(12,2) NOT NULL,
    currency     CHAR(3)       NOT NULL,
    reason       VARCHAR(24)   NOT NULL,
    status       VARCHAR(12)   NOT NULL DEFAULT 'PENDING',
    is_mock      BOOLEAN       NOT NULL DEFAULT TRUE,
    processed_at TIMESTAMPTZ,
    created_at   TIMESTAMPTZ   NOT NULL DEFAULT now(),

    CONSTRAINT ck_refund_amount CHECK (amount > 0),
    CONSTRAINT ck_refund_reason CHECK (reason IN
        ('REQUESTER_CANCELLED','PROVIDER_CANCELLED','NO_SHOW','SYSTEM','DISPUTE')),
    CONSTRAINT ck_refund_status CHECK (status IN ('PENDING','COMPLETED','FAILED'))
);

CREATE TABLE review (
    id          UUID PRIMARY KEY,
    booking_id  UUID        NOT NULL REFERENCES session_booking(id) ON DELETE CASCADE,
    reviewer_id UUID        NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    reviewee_id UUID        NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    rating      SMALLINT    NOT NULL,
    body        TEXT,
    is_public   BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT ck_review_rating   CHECK (rating BETWEEN 1 AND 5),
    CONSTRAINT ck_review_not_self CHECK (reviewer_id <> reviewee_id),
    CONSTRAINT uq_review_once     UNIQUE (booking_id, reviewer_id)   -- one review per side
);
```

**[CHANGED] — `ck_payment_method` narrowed to `('MOCK')`.** `1on1_sb` allowed
`RAZORPAY` and `STRIPE`. Payments are explicitly simulated
(`docs/02-technology-stack.md` §21), and a constraint permitting values the
system cannot produce is a lie about the data. Widening a `CHECK` later is one
`ALTER TABLE`.

`uq_payment_live` is a partial unique index doing subtle work: a booking may
accumulate several `FAILED` payment attempts, but only **one** live payment.
`idempotency_key` separately makes a retried "pay" request safe to replay.

---

## 9. Index catalogue — every index justified

Principles applied: **equality → sort → range** column order; no
prefix-redundant indexes; **every FK child column indexed** (Postgres does *not*
do this automatically — an unindexed FK makes `DELETE` on the parent full-scan
the child *while holding locks*); partial indexes wherever a lifecycle column
exists.

| Index | Definition | Justification |
|---|---|---|
| `uq_app_user_email_lower` | `(LOWER(email))` UNIQUE | Login lookup + case-insensitive uniqueness in one object |
| `uq_app_user_username` | `(username)` UNIQUE | Profile-by-handle lookup |
| `ix_app_user_name_trgm` | GIN `(full_name gin_trgm_ops)` | Fuzzy people search. B-tree cannot serve `ILIKE '%x%'` |
| `ix_app_user_provider` | `(id) WHERE is_provider` | Discover browses providers only — a small fraction of users |
| `ix_refresh_token_user` | `(user_id) WHERE revoked_at IS NULL` | **FK index** + "log out everywhere". Partial: revoked rows are never queried, only retained |
| `pk_follow` | `(follower_id, following_id)` | "Who do I follow" + uniqueness |
| `ix_follow_reverse` | `(following_id, created_at DESC)` | **"Who follows me" is not a prefix of the PK.** The single most common social-schema indexing mistake — without this, follower lists full-scan |
| `ix_post_author` | `(author_id, published_at DESC, id DESC) WHERE deleted_at IS NULL` | Profile timeline. E→S→R: equality author, then sort. `id` is the keyset tiebreaker |
| `ix_post_feed` | `(published_at DESC, id DESC) WHERE deleted_at IS NULL AND visibility = 'PUBLIC'` | Public feed page. Partial keeps deleted/private rows out of the hot index |
| `ix_comment_post` | `(post_id, created_at) WHERE deleted_at IS NULL` | **FK index** + threaded read order |
| `ix_comment_author` | `(author_id)` | **FK index.** Without it, deleting a user full-scans `comment` |
| `ix_comment_parent` | `(parent_comment_id, created_at) WHERE parent_comment_id IS NOT NULL` | **FK index** + reply expansion. Partial: most comments are top-level |
| `pk_post_like` | `(post_id, user_id)` | Like-count aggregation + structural uniqueness |
| `ix_post_like_user` | `(user_id, created_at DESC)` | **FK index** (`user_id` is not the PK prefix) + "posts I liked" |
| `ix_offering_provider` | `(provider_id, status)` | **FK index** + provider's own dashboard |
| `ix_offering_published` | `(price_amount, duration_minutes) WHERE status = 'PUBLISHED'` | Discover filters by price/duration; only published offerings are ever browsed |
| `ix_avail_provider_day` | `(provider_id, day_of_week) WHERE is_active` | **FK index** + slot generation, the hottest read in booking |
| `ex_avail_no_overlap` | GiST exclusion | Correctness first; also a usable GiST index |
| `ix_booking_provider_time` | `(provider_id, scheduled_start_at DESC)` | **FK index** + provider calendar |
| `ix_booking_requester_time` | `(requester_id, scheduled_start_at DESC)` | **FK index** + "my bookings" |
| `ix_booking_offering` | `(offering_id)` | **FK index.** `ON DELETE RESTRICT` must check this on every offering delete |
| `ix_booking_pending` | `(provider_id, requested_at) WHERE status = 'REQUESTED'` | Provider's request inbox — a tiny slice of the table |
| `ix_booking_upcoming` | `(scheduled_start_at) WHERE status IN ('ACCEPTED','RESCHEDULED')` | Reminder scheduler sweeps by time across all users |
| `uq_booking_live_request` | partial UNIQUE | Race protection level 1 (§7.1) |
| `ex_booking_provider_no_overlap` | GiST exclusion | Race protection level 2 (§7.1) |
| `ex_booking_requester_no_overlap` | GiST exclusion | Requester cannot be in two places at once |
| `ix_status_history_booking` | `(booking_id, created_at)` | **FK index** + audit trail read in order |
| `uq_payment_live` | partial UNIQUE | One live payment per booking/payer |
| `ix_payment_payer` / `ix_payment_payee` | `(…, created_at DESC)` | **FK indexes** + transaction history |
| `ix_refund_payment` | `(payment_id)` | **FK index** — `ON DELETE RESTRICT` |
| `ix_review_reviewee` | `(reviewee_id, created_at DESC) WHERE is_public` | **FK index** + public reviews on a profile |
| `ix_message_conversation` | `(conversation_id, created_at DESC, id DESC)` | **FK index** + keyset pagination of a thread |

**Deliberately NOT created:**

- No index on `post(visibility)` or `booking(status)` alone — low cardinality;
  Postgres will seq-scan anyway, and they already ride in partial predicates.
- No `(author_id)` on `post` — redundant prefix of `ix_post_author`.
- No index on `app_user(created_at)` — no query orders users by signup date.

**Pagination:** use **keyset**, never `OFFSET`.

```sql
-- page 1
SELECT … FROM post WHERE deleted_at IS NULL ORDER BY published_at DESC, id DESC LIMIT 20;
-- page N: pass the last row's values back
SELECT … FROM post
 WHERE deleted_at IS NULL AND (published_at, id) < ($1, $2)
 ORDER BY published_at DESC, id DESC LIMIT 20;
```

`OFFSET 10000` makes Postgres fetch and discard 10 000 rows — cost grows
linearly with depth — and it *skips rows* when new posts arrive mid-scroll. The
`(published_at, id)` row-comparison needs the tiebreaker because
`published_at` is not unique.

---

## 10. Deliberately NOT carried over from `1on1_sb`

### Java/JPA artefacts

| Dropped | Why |
|---|---|
| `version BIGINT NOT NULL DEFAULT 0` on every table | Hibernate `@Version` optimistic locking. **Without JPA it does nothing** — no Node driver checks or increments it. Keeping it would be a column that *looks* like it protects against lost updates while providing zero protection. The exclusion constraints give the real guarantee. |
| `pgcrypto` + `gen_random_uuid()` | UUIDv4 defaults; replaced by app-generated UUIDv7 (§3) |
| `email_normalized` column | Replaced by a `LOWER(email)` expression index — one source of truth (§5) |
| Surrogate `id` on `follow` | Natural composite PK is one index cheaper (§6) |
| **Flyway itself** | ⚠️ Flyway is a **JVM tool**. `CLAUDE.md` forbids Java in this repo. Use a Node migrator — `node-pg-migrate` or Knex. The *migrations* port; the *runner* does not. |

### Features out of current scope

Dropped because `1on1` is not building them yet, and unused tables are
maintenance cost plus a misleading map of the product:

`problem`, `submission`, `badge`, `user_badge` (gamification) ·
`certification`, `certificate_verification` (blockchain certification, §32
"future") · `meeting_transcript`, `meeting_notes`, `meeting_recording`,
`meeting_artifact` (AI meeting intelligence) · `moderation_record`,
`agent_action` (AI moderation/agent audit) · `poll_option`, `poll_vote` ·
`user_block`, `report` · `user_skill`, `user_experience`, `user_education`,
`user_project`, `user_link` (rich profile — add when the profile UI exists) ·
`cancellation_policy`, `cancellation_policy_rule`, `booking_cancellation`
(cancellation engine — see below) · `notification`.

**Two worth calling out specifically:**

- **`cancellation_policy` was cut but `session_booking` referenced it
  `NOT NULL`.** That FK is removed here. When the cancellation engine
  (`docs/02` §22) is built, add the table and the FK together. This is the kind
  of dependency that silently breaks a partial port.
- **`notification` is deferred, not rejected** — `docs/03` §26 specifies it.
  It arrives with the notification feature; its shape (`recipient_id`,
  `read_at`, partial index `WHERE read_at IS NULL`) is already clear.

---

## 11. Migration notes (for when migrations are written)

**No migration files have been written.** When they are:

1. **`CREATE EXTENSION btree_gist` must come first.** Every exclusion constraint
   depends on it.
2. **`CREATE INDEX CONCURRENTLY` cannot run inside a transaction block.** Most
   migration runners — Flyway, `node-pg-migrate`, Knex — wrap each migration in
   one by default, so a concurrent build fails at deploy time on the first
   non-empty table. Mark such migrations non-transactional
   (`exports.config = { transaction: false }` in `node-pg-migrate`). On an empty
   database this never surfaces; it appears the first time you add an index to a
   populated table in staging.
3. **Order by dependency, not topic.** `app_user` → `session_offering` →
   `session_booking` → `payment` → `booking_participant`.
4. **Never edit an applied migration.** Add a new one.
5. Exclusion constraints are added by `ALTER TABLE` after the table exists, so
   they read as deliberate rather than buried in a column list.

---

## 12. Open questions

1. **Counter maintenance** — triggers or application code? Triggers are
   correct-by-construction; application code is easier to debug. Recommend
   triggers, since a drifted `follower_count` is visible to users.
2. **`conversation` ↔ `booking` cardinality** — is a conversation always tied to
   a booking, or can users DM freely? Currently nullable, allowing both.
3. **Full-text search** — a GIN `to_tsvector` index on `post.body` was in
   `1on1_sb` and is omitted here until search requirements firm up
   (`docs/03` §8). Cheap to add.
