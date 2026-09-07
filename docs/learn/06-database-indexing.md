# Database Indexing — everything, from the disk page up to your booking table

> **The one-sentence version:** an index is a *second copy of some of your data,
> kept permanently sorted*, that the database maintains on every write so it can
> answer reads by walking a tree instead of reading every row. Every index you add
> is a read you made fast and a write you made slower — indexing is entirely the
> art of choosing that trade well.

This document is written against **this repo**. `backend/src/server.js` has no data
layer yet, and on **2026-09-06 the database was decided: RDS PostgreSQL** (recorded in
the root `CLAUDE.md`). So everything here is directly actionable — §14 is the index
plan you will actually run, not a hypothetical.

§13 keeps the three-way comparison against DocumentDB and DynamoDB anyway. Not as a
live option, but because *why* Postgres wins for a join-heavy social graph is the part
that transfers to the next project; the conclusion alone teaches nothing.

Every example below uses your real access patterns: follow, feed, search, session
offering, booking, availability, message, notification, certificate.

---

## Contents

| § | Topic | The question it answers |
|---|---|---|
| 1 | [The physical picture](#1-the-physical-picture) | *What IS an index, as bytes on a disk?* |
| 2 | [The B+Tree](#2-the-btree--the-default-index) | *Why is it fast, in actual numbers?* |
| 3 | [What an index costs](#3-what-an-index-costs) | *Why not index every column?* |
| 4 | [How the planner chooses](#4-how-the-planner-decides-to-use-it) | *Why is my index being ignored?* |
| 5 | [Composite indexes](#5-composite-indexes-and-the-leftmost-prefix-rule) | *Why does column order matter so much?* |
| 6 | [Covering indexes](#6-covering-indexes-and-index-only-scans) | *How do I skip the table entirely?* |
| 7 | [Sargability](#7-sargability--how-to-accidentally-disable-your-own-index) | *What silently kills an index?* |
| 8 | [The other index types](#8-the-other-index-types) | *When is a B-tree the wrong shape?* |
| 9 | [Indexes as correctness](#9-indexes-as-correctness-not-just-speed) | *How an index fixes your booking race condition* |
| 10 | [Clustered vs secondary](#10-clustered-vs-secondary--postgres-vs-innodb) | *Why the same index behaves differently in MySQL* |
| 11 | [Pagination](#11-pagination--the-index-problem-nobody-warns-you-about) | *Why page 500 of the feed takes 4 seconds* |
| 12 | [Reading EXPLAIN](#12-reading-explain--the-only-skill-that-actually-matters) | *How do I diagnose instead of guess?* |
| 13 | [Mongo & DynamoDB](#13-the-same-ideas-in-mongodb-and-dynamodb) | *How does this change on your AWS options?* |
| 14 | [The 1on1 index plan](#14-the-actual-1on1-index-plan) | *Concretely, what do I write?* |
| 15 | [Operations](#15-operating-indexes-in-production) | *Create, drop, monitor without downtime* |
| 16 | [Anti-patterns](#16-anti-patterns-and-myths) | *What everyone gets wrong* |
| 17 | [Cheat sheet](#17-cheat-sheet) | *The whole doc in one screen* |

---

## 1. The physical picture

Forget SQL for sixty seconds. A table on disk is a **heap**: a pile of fixed-size
blocks (Postgres calls them *pages*, 8 KB each by default), each holding as many rows
as fit. Rows sit in whatever order they were inserted. There is no sorting. There is
no structure.

```text
  users HEAP  (unordered — insertion order only)

  page 0        page 1        page 2              page 4210
 ┌──────────┐  ┌──────────┐  ┌──────────┐        ┌──────────┐
 │ teja     │  │ arun     │  │ meera    │  ...   │ zoya     │
 │ ravi     │  │ dev      │  │ sana     │        │ kiran    │
 │ nikhil   │  │ priya    │  │ arjun    │        │ ...      │
 └──────────┘  └──────────┘  └──────────┘        └──────────┘
```

Now run `SELECT * FROM users WHERE email = 'teja@example.com'`.

With no index the database has exactly one option — the **sequential scan**. Read
page 0, check every row. Read page 1, check every row. …Read page 4210. It cannot
stop early even after it finds a match, because it does not know the email is unique;
there might be another one on page 4209.

That is 4,211 page reads for one row. The cost is **O(n)**, and n is the number of
*pages*, not rows — which is the most important reframe in this whole document:

> **The unit of cost is the page read, not the row.** Everything a database does to
> go fast is an attempt to touch fewer 8 KB blocks. All of indexing follows from this.

An index is a **separate structure, in its own file**, holding *(indexed value →
location of the row)* pairs, permanently sorted by that value:

```text
  idx_users_email        (sorted by email, always)

    arjun@…    → page 2, slot 3
    arun@…     → page 1, slot 1
    dev@…      → page 1, slot 2
    kiran@…    → page 4210, slot 2
    meera@…    → page 2, slot 1
    nikhil@…   → page 0, slot 3
    priya@…    → page 1, slot 3
    ravi@…     → page 0, slot 2
    sana@…     → page 2, slot 2
    teja@…     → page 0, slot 1     ◄── found by descending a tree, not by scanning
    zoya@…     → page 4210, slot 1
```

Two consequences fall straight out, and they are the entire trade-off:

1. **Sorted ⇒ you can binary search it.** You do not read the index; you *descend* it.
2. **Sorted ⇒ every insert must be placed in the right position, forever.** The
   database now does extra work on every `INSERT`, on every `UPDATE` of an indexed
   column, and on every `DELETE`. That is the bill (§3).

The location pointer has a name. In Postgres it is the **ctid** — a `(page, slot)`
tuple identifier. In MySQL/InnoDB it is the primary key value (§10). In MongoDB it is
the record id. The name changes; the idea does not.

---

## 2. The B+Tree — the default index

A flat sorted list is fine on paper and terrible on disk: inserting into the middle
would mean shifting everything after it. Real databases use a **B+Tree** — a shallow,
extremely wide, self-balancing tree. When you type `CREATE INDEX` with no `USING`
clause, this is what you get, in every database in §13.

```text
                     ┌───────────────────────┐
        ROOT         │  m │  s                │        1 page, always cached
                     └──┬─┴──┬─┴──┬───────────┘
           <m ┌────────┘    │     └────────┐ ≥s
              ▼             ▼ m..s         ▼
      ┌────────────┐  ┌────────────┐  ┌────────────┐
INTERNAL│ d │ h    │  │ n │ p │ r  │  │ t │ w      │   ~1-2 levels for 100M rows
      └──┬───┬───┬─┘  └──┬───┬───┬─┘  └──┬───┬─────┘
         ▼   ▼   ▼       ▼   ▼   ▼       ▼   ▼
   ┌─────────┐ ┌──────────┐ ┌─────────┐ ┌──────────┐
   │arjun→p2 │ │meera→p2  │ │ravi→p0  │ │teja→p0   │  ◄─ LEAVES: value + pointer
   │arun→p1  │ │nikhil→p0 │ │sana→p2  │ │zoya→p4210│
   └────┬────┘ └────┬─────┘ └────┬────┘ └────┬─────┘
        └───────────┴────────────┴───────────┘
              leaves are linked left↔right   ◄─ this is the "+" in B+Tree:
              (doubly-linked list)              range scans walk sideways
```

Three properties matter, and each buys you a specific query shape:

| Property | What it buys you |
|---|---|
| Only **leaves** hold data pointers; internal nodes are pure signposts | Internal nodes pack in far more keys → the tree is shallower |
| Leaves are **linked to their neighbours** | `BETWEEN`, `>`, `<`, `LIKE 'ab%'` — find the start, then walk sideways |
| It is **always balanced** — every leaf sits at the same depth | Worst case = best case. No pathological data ordering |

### The numbers, because the numbers are the point

An 8 KB internal page holding ~20-byte entries stores roughly **400 keys**. That is
the *fanout*. Depth grows logarithmically at base 400:

```text
  depth 1 (root only) →            400 rows
  depth 2             →        160,000 rows
  depth 3             →     64,000,000 rows
  depth 4             → 25,600,000,000 rows
```

So a table with **64 million users** has a **3-level** index. Finding one user:

```text
  read root page      (level 1)   ← essentially always in RAM
  read internal page  (level 2)   ← almost always in RAM
  read leaf page      (level 3)   ← often in RAM
  read heap page                  ← the actual row
  ──────────────────────────────
  ~4 page reads, of which typically 1 touches disk
```

**4 reads instead of 4,211** — and it barely degrades as you grow, because you must
multiply the table by 400× to add one more level. That is what "O(log n)" means here,
and it is why indexes feel like magic: *the log base is enormous*.

> **Keep this instinct:** a B+Tree lookup is ~3–4 page reads whether the table holds a
> million rows or a billion. So if a query is slow, the index is almost certainly not
> being used. Adding *more* index rarely helps; understanding §4 and §7 always does.

### What a B+Tree can and cannot do

Because it is sorted, it supports anything that maps to *"jump to a position, then
read forwards"*:

| Query on `idx_users_email` | Works? | Why |
|---|---|---|
| `email = 'teja@…'` | ✅ | descend to the exact position |
| `email > 'm'` / `BETWEEN` | ✅ | descend to `m`, then walk right |
| `email LIKE 'te%'` | ✅ | it *is* a range: `>= 'te' AND < 'tf'` |
| `ORDER BY email` | ✅ | the index is already that order — **no sort step at all** |
| `MIN(email)` / `MAX(email)` | ✅ | leftmost / rightmost leaf, O(depth) |
| `email LIKE '%teja%'` | ❌ | no starting position exists — see §7 |
| `LOWER(email) = 'teja@…'` | ❌ | the tree is sorted by `email`, not by `LOWER(email)` |

That fourth row is quietly one of the biggest wins available to you: an index does not
only filter, it **supplies ordering for free**. A query that would otherwise buffer
200k rows and sort them can instead read 50 rows off a leaf and stop.

The last row is the one to internalise early: **an index is sorted by an exact
expression. Query a different expression and the sort order is meaningless.**

---

## 3. What an index costs

This is the half of indexing that tutorials skip, and it is exactly why "just index
everything" is wrong.

### 3.1 Write amplification

A table with 5 indexes turns **one** logical insert into **six** physical writes:

```text
  INSERT INTO bookings (…)
      │
      ├── write the row into the heap                        1 write
      ├── insert into idx_bookings_provider_start            2
      ├── insert into idx_bookings_seeker                    3
      ├── insert into idx_bookings_status                    4
      ├── insert into idx_bookings_offering                  5
      └── insert into idx_bookings_created_at                6
```

Each of those is a tree descent *plus* a possible **page split**: when a leaf fills up
it is cut in half and the parent updated — which can cascade upward to the root. Under
a write burst your p99 insert latency is dominated by splits you never see.

`UPDATE` is subtler, and worth knowing precisely:

- Updating a column that is in **no** index → in Postgres this may be a **HOT update**
  (Heap-Only Tuple): the new row version goes on the same page and *no index is
  touched at all*. Effectively free.
- Updating a column that **is** indexed → every index containing it must be updated.
  Postgres implements that as delete + insert, and both row versions now exist until
  `VACUUM` cleans up.

> **Practical rule:** on a hot write path (messages, notifications, presence), count
> your indexes. Three is a decision. Eight is a mistake nobody made on purpose.

### 3.2 Storage

An index on a `uuid` column of a 10M-row table is roughly
10M × (16 B key + ~8 B pointer + overhead) ≈ **400+ MB**. Indexes routinely exceed the
size of the table they index. On RDS you pay for that disk, that backup window, and
that restore time.

### 3.3 Cache pressure — the invisible cost

Your database has a fixed buffer pool (RAM). Index pages and heap pages compete for
it. A large, never-used index is still written to, and those writes **evict pages you
actually needed**. An unused index is not neutral; it is a slow leak. §15 shows how to
find them.

### 3.4 Planning cost

Every extra index is another option the planner must cost out. With 15 indexes on a
table, planning time itself becomes measurable on otherwise trivial queries.

---

## 4. How the planner decides to use it

The most common beginner question is *"I created an index and it isn't being used — is
it broken?"* Usually it is not broken; the planner ran the numbers and a sequential
scan genuinely won.

A modern database is a **cost-based optimiser**. It estimates, for each candidate
plan, how many pages it must read, and picks the cheapest. Two ideas drive that
estimate:

**Cardinality** — how many distinct values a column has.
**Selectivity** — what fraction of the table a predicate keeps: `matched / total`.

```text
  SELECTIVITY                        BEST PLAN
  ───────────────────────────────────────────────────────────────
  0.000001  email = 'teja@…'         Index Scan          ✅ obviously
  0.01      provider_id = 42         Index Scan          ✅
  0.05      city = 'Hyderabad'       Bitmap Index Scan   ~ borderline
  0.30      status = 'confirmed'     Seq Scan            ✅ index is SLOWER
  0.60      is_active = true         Seq Scan            ✅ index is a waste
```

### Why a low-selectivity index scan actually loses

Because of **random vs sequential I/O**. An index scan finds row pointers in sorted
*index* order, which is an essentially random order in the *heap* — so it jumps:
page 4210, page 3, page 891, page 12. If your query touches 30% of rows you will visit
nearly every heap page anyway, in the worst possible order, *and* you will have read
the index on top. A sequential scan reads every page once, in physical order, and the
storage layer happily prefetches ahead of it.

> **Corollary that surprises people:** an index on a low-cardinality column
> (`is_verified`, `status`, `role`) is usually dead weight. Two exceptions: a
> **partial index** (§8), and the case where the value you search for is *rare* —
> `status = 'refunded'` at 0.2% is highly selective even though the column has only
> five distinct values.

### The middle ground: Bitmap Index Scan

Postgres has a third mode for the awkward 1–10% zone. It reads the index, builds a
bitmap of *pages* it needs, sorts that bitmap, then reads the heap **in physical
order** — index precision with sequential-ish I/O. Seeing `Bitmap Heap Scan` in a plan
is normal and healthy, not a fallback. It is also how Postgres combines two separate
indexes with `AND`/`OR` (`BitmapAnd`, `BitmapOr`).

### Statistics — the reason a plan changes overnight

The planner does not count rows; it reads **statistics** (histograms, most-common
values, distinct-value estimates) gathered by `ANALYZE`. Stale statistics are the #1
cause of "it was fast yesterday". After a bulk load, `ANALYZE` the table before you
benchmark anything. And when an estimate is wildly wrong — plan says `rows=1`, reality
is `rows=240000` — *that* is your bug, not the index.

---

## 5. Composite indexes and the leftmost-prefix rule

A **composite** (multi-column) index sorts by column 1, ties broken by column 2, then
by column 3. Exactly like sorting a spreadsheet by three columns.

For your bookings table:

```sql
CREATE INDEX idx_bookings_provider_start
    ON bookings (provider_id, starts_at);
```

```text
  provider_id │ starts_at            ← sorted by provider FIRST, then by time
  ────────────┼──────────────────────
      7       │ 2026-09-01 10:00     ┐
      7       │ 2026-09-01 18:00     ├── one contiguous block: this provider's
      7       │ 2026-09-04 19:00     │   entire calendar, already in time order
      7       │ 2026-09-11 07:00     ┘
     12       │ 2026-08-30 09:00
     12       │ 2026-09-02 21:00
     41       │ 2026-09-02 08:00
```

**The leftmost-prefix rule:** the index can serve any query that constrains a *prefix*
of the column list — and it can then range-scan on the first unconstrained column
after that prefix.

| Query | Uses the index? |
|---|---|
| `WHERE provider_id = 7` | ✅ prefix |
| `WHERE provider_id = 7 AND starts_at > now()` | ✅ **the ideal case** |
| `WHERE provider_id = 7 ORDER BY starts_at` | ✅ and **no sort step** — ordering is free |
| `WHERE starts_at > now()` | ❌ skips the leading column\* |
| `WHERE starts_at > now() AND provider_id = 7` | ✅ the order you type clauses is irrelevant |

\* Postgres can use a non-leading column as an in-index *filter*, and Postgres 18
added a limited "skip scan" for low-cardinality leading columns. Treat both as a
bonus — design for the prefix rule.

### The ordering rule: **E–S–R**

For picking column order, this heuristic (named in the MongoDB docs, but true
everywhere) is the best one there is:

```text
   E  Equality   columns compared with =        →  FIRST
   S  Sort       columns you ORDER BY           →  NEXT
   R  Range      >, <, BETWEEN, LIKE 'x%'       →  LAST
```

Why range goes last: the moment you range-scan a column, every column after it in the
index is no longer in a usable order. You get the benefit of **one** range column; the
rest degrade to filters.

Worked example — your provider dashboard query:

```sql
SELECT * FROM bookings
 WHERE provider_id = 7            -- E
   AND status      = 'confirmed'  -- E
   AND starts_at  >= now()        -- R
 ORDER BY starts_at;              -- S (already satisfied by R's column)

CREATE INDEX ON bookings (provider_id, status, starts_at);
--                        └── E ──┘  └─ E ─┘  └─── S/R ───┘
```

Get that order wrong — `(starts_at, provider_id, status)` — and every provider's
dashboard scans the entire future calendar and filters it down.

### Fewer, wider indexes beat many narrow ones

`(a, b, c)` also serves `(a, b)` and `(a)`. Therefore:

```text
  ❌  idx(provider_id)                    ─┐
      idx(provider_id, status)             ├─ 3 indexes, 3× write cost,
      idx(provider_id, status, starts_at) ─┘   and the first two are redundant

  ✅  idx(provider_id, status, starts_at)    ← one index, serves all three
```

Auditing for **redundant indexes** — any index whose column list is a prefix of
another's — is usually the fastest write-throughput win available on a legacy table.

---

## 6. Covering indexes and index-only scans

Recall the two-step: find the pointer in the index, then fetch the row from the heap.
That second step is the random I/O. If **every column the query needs already lives in
the index**, the database can skip the heap entirely — an **index-only scan**.

```sql
-- The feed ranking pass needs only these three columns:
SELECT author_id, created_at, score
  FROM posts
 WHERE author_id = ANY($1)
 ORDER BY created_at DESC
 LIMIT 50;

CREATE INDEX idx_posts_feed
    ON posts (author_id, created_at DESC)
    INCLUDE (score);            -- ← payload: stored in the leaf, not sorted by
```

`INCLUDE` (Postgres 11+) is the precise tool for columns you need to *return* but never
search or sort by. They inflate the leaf pages but not the tree structure, and they do
not participate in uniqueness. In MySQL you get the same effect by appending the column
to the key itself; in MongoDB, by adding it to the index and using a projection.

**Postgres caveat you must know:** an index-only scan still consults the **visibility
map**, because indexes do not store MVCC visibility information. On a heavily-updated,
under-vacuumed table your "index-only scan" quietly does heap fetches anyway.
`EXPLAIN (ANALYZE)` reports it as `Heap Fetches: 148231` — when that number is large,
the fix is `VACUUM`, not a different index.

---

## 7. Sargability — how to accidentally disable your own index

**Sargable** = "Search ARGument able" = the predicate can be turned into an index
range. The rule is one line:

> **The indexed column must appear bare on one side of the comparison.** Wrap it in
> anything and the index is sorted by the wrong thing.

| ❌ Not sargable | ✅ Rewrite | Why |
|---|---|---|
| `WHERE LOWER(email) = $1` | index `LOWER(email)`, or use `citext` | tree is sorted by `email` |
| `WHERE DATE(created_at) = '2026-09-06'` | `created_at >= '2026-09-06' AND created_at < '2026-09-07'` | same reason — and the rewrite is a clean range scan |
| `WHERE starts_at + interval '1 hour' > now()` | `starts_at > now() - interval '1 hour'` | move the arithmetic to the constant side |
| `WHERE title LIKE '%react%'` | trigram or full-text index (§8) | no start position exists in a sorted list |
| `WHERE user_id::text = $1` | send the correct type | an implicit cast wraps the column |
| `WHERE status != 'cancelled'` | `status IN ('pending','confirmed')` | negation is not a range |
| `WHERE provider_id = 7 OR seeker_id = 7` | `UNION ALL` of two indexed queries | `OR` across two columns cannot use one tree |
| `WHERE ($1::text IS NULL OR city = $1)` | build the WHERE clause dynamically | the "optional filter" trap — kills every plan |

Two of these will bite *this* codebase specifically:

**The type-mismatch trap.** JavaScript has one number type, and your query layer will
happily send a string. `WHERE id = '7'` against a `bigint` may still work via implicit
cast, but the reverse — a numeric literal against a column your migration declared
`text` — will scan. When a query is inexplicably slow, check the **types** before you
check the index.

**The optional-filter trap.** Your search endpoint has ~9 optional filters (skill,
experience, company, education, location, price, availability, rating, provider
status). The tempting single query —
`WHERE ($1 IS NULL OR skill = $1) AND ($2 IS NULL OR city = $2) AND …` — is
fundamentally unindexable, because the planner must produce **one** plan that stays
correct for all 512 filter combinations, so it plans for the worst one. Build the
`WHERE` clause from the filters actually supplied, or push search to a dedicated index
type (§8).

**Expression indexes** are the escape hatch for the first two rows. If you genuinely
need `LOWER(email)`, index exactly that:

```sql
CREATE UNIQUE INDEX idx_users_email_lower ON users (LOWER(email));
```

The indexed expression must match the queried expression. This is also how you enforce
case-insensitive unique emails — which is what §4 of the system design actually wants,
since `Teja@x.com` and `teja@x.com` must not be two accounts.

---

## 8. The other index types

B-tree is the default and covers ~90% of real needs. The rest exist because some data
has no useful total order — and *"sorted"* is the only trick a B-tree knows.

| Type | Shape it fits | Operators | Where it lands in 1on1 |
|---|---|---|---|
| **B-tree** | ordered scalars | `= < > BETWEEN LIKE 'x%' ORDER BY` | everything by default |
| **Hash** | equality only | `=` | rarely worth it; B-tree already does `=` and more |
| **GIN** | *many values inside one row* | `@> ? && @@` | `skills[]`, JSONB profile, full-text search |
| **GiST** | overlap / nearness / geometry | `&& <-> @>` | **booking time ranges**, "providers near me" |
| **BRIN** | huge, naturally-ordered tables | ranges over correlated data | `messages`, `notifications` by time |
| **Partial** | *any* type + a `WHERE` clause | as its base type | unread notifications, active bookings |
| **Expression** | a computed value | as its base type | `LOWER(email)`, `date_trunc('day', …)` |

### GIN — the inverted index

A B-tree maps one row → one key. **GIN** (Generalized Inverted iNdex) maps one row →
*many* keys, which is what you need for arrays, JSONB and text. It stores
`key → list of rows containing it` — literally the index at the back of a book.

```text
  posts.tags = ['react','architecture']  (row 88)
  posts.tags = ['react','testing']       (row 91)

  GIN index:
     'architecture' → [88]
     'react'        → [88, 91]      ◄── one entry, many rows
     'testing'      → [91]
```

Two direct uses in your §8 Search Architecture:

```sql
-- Skill filtering: users.skills is text[]
CREATE INDEX idx_users_skills ON users USING gin (skills);
SELECT * FROM users WHERE skills @> ARRAY['react'];        -- "contains"

-- Full-text search over profile headline + bio
ALTER TABLE users ADD COLUMN search_doc tsvector
  GENERATED ALWAYS AS (
      to_tsvector('english', coalesce(headline,'') || ' ' || coalesce(bio,''))
  ) STORED;
CREATE INDEX idx_users_search ON users USING gin (search_doc);
SELECT * FROM users WHERE search_doc @@ plainto_tsquery('english', 'react architecture');
```

And the fix for `LIKE '%react%'` from §7 — **trigram** matching, which chops strings
into 3-character grams and inverts those:

```sql
CREATE EXTENSION pg_trgm;
CREATE INDEX idx_offerings_title_trgm ON session_offerings USING gin (title gin_trgm_ops);
-- now this is indexed, wildcards and all:
SELECT * FROM session_offerings WHERE title ILIKE '%react%';
```

GIN's trade: **fast reads, slow writes, large size**. It is the right call for search
columns and the wrong call for anything on your hot path.

### GiST — overlap, and why it matters for bookings

GiST is a *framework* for indexing things where "less than" is meaningless but
"overlaps" or "is near" is not. The killer use for you is **time ranges** — see §9.

### BRIN — the cheap one for time-series

BRIN stores, per block range (default 128 pages), just the min and max value. That
makes it laughably small — a BRIN index on 100M rows can be a few hundred KB — but it
only works when **physical row order correlates with the column's order**. Which is
exactly true for append-only tables like `messages` and `notifications`, where rows
arrive in `created_at` order and are never updated.

```sql
CREATE INDEX idx_messages_created_brin ON messages USING brin (created_at);
```

If rows get shuffled (heavy updates, `VACUUM FULL` reordering, backfills), the
correlation breaks and BRIN silently degrades toward a seq scan. Check
`pg_stats.correlation` for the column before reaching for it.

### Partial indexes — the most underrated one

A **partial index** indexes only the rows matching a predicate. Smaller tree, fewer
writes, and it directly rescues the low-cardinality problem from §4.

```sql
-- Notifications: 99% are read. You only ever query the unread ones.
CREATE INDEX idx_notifications_unread
    ON notifications (user_id, created_at DESC)
    WHERE read_at IS NULL;
```

That index contains only unread rows — perhaps 1% of the table. It stays hot in RAM,
and marking a notification read *removes* the entry rather than updating it. The
planner uses it only when it can prove the query implies the predicate, so your query
must contain `WHERE read_at IS NULL` literally.

The same trick, applied to your booking flow:

```sql
CREATE INDEX idx_bookings_active
    ON bookings (provider_id, starts_at)
    WHERE status IN ('pending', 'confirmed');
```

Cancelled and completed bookings accumulate forever and are never on the hot path.
Excluding them keeps this index roughly constant-sized as history grows.

---

## 9. Indexes as correctness, not just speed

This section is the one that changes how you think about the topic. So far an index
has been a performance tool. It is also a **concurrency primitive** — and it is the
correct answer to §11 of your system design, *"Session Booking Race Condition."*

### The bug that application code cannot fix

```text
  time   Request A (Ravi)                Request B (Meera)
  ────────────────────────────────────────────────────────────────
   t0    SELECT … WHERE slot free  → 0 rows
   t1                                    SELECT … WHERE slot free  → 0 rows
   t2    INSERT booking  ✅
   t3                                    INSERT booking  ✅  ← double booked
```

Both requests checked, both saw an empty slot, both inserted. No amount of careful
JavaScript closes this window, because the check and the write are two separate
statements and the database happily interleaves them. The doc's own instruction —
*"Backend checks existing booking → Atomic/transaction-safe reservation"* — is
correct, and **a unique index is how you actually implement it.**

### Level 1 — a unique index

```sql
CREATE UNIQUE INDEX idx_bookings_no_double
    ON bookings (provider_id, starts_at)
    WHERE status IN ('pending', 'confirmed');
```

Now request B's `INSERT` fails at t3 with a unique-violation error, atomically, inside
the engine, no matter how many Node processes you scale to. Your handler catches
Postgres error code `23505` and returns `409 Conflict`. The invariant now lives in the
database, where it cannot be bypassed by a second code path — which is precisely the
"one source of truth" rule from §35 of your system design, applied to data instead of
functions.

Note what happened structurally: **a unique constraint IS an index.** Postgres and
MySQL implement `UNIQUE` and `PRIMARY KEY` by creating one, because uniqueness is only
enforceable if you can look up "does this value already exist?" in O(log n). You get
the read performance for free as a side effect of the correctness guarantee.

### Level 2 — exclusion constraints, for *overlapping* ranges

A unique index catches identical start times. It does **not** catch a 60-minute
session starting at 19:00 colliding with one starting at 19:30. For that you need
GiST and an exclusion constraint:

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE bookings ADD CONSTRAINT bookings_no_overlap
  EXCLUDE USING gist (
      provider_id WITH =,                            -- same provider
      tstzrange(starts_at, ends_at) WITH &&          -- AND overlapping time
  ) WHERE (status IN ('pending','confirmed'));
```

Read it as: *no two active rows may share a provider AND have overlapping time
ranges.* That is your entire double-booking rule, declared once, enforced by an index,
impossible to violate from any code path — the AI agent's `bookSession()` tool
included. `btree_gist` is needed only because `provider_id` is a scalar and plain GiST
does not handle `=` on scalars alone.

> **The general lesson:** whenever you catch yourself writing "check, then insert",
> ask whether a unique or exclusion index can turn that into "insert, and let the
> engine reject it". Read-then-write is a race; a constraint is a guarantee.

### Foreign keys: the index Postgres does *not* create for you

`REFERENCES` creates an index on the **referenced** (parent) side automatically — it
is the primary key. It creates **nothing** on the referencing (child) side. So:

```sql
CREATE TABLE bookings (
  id          bigserial PRIMARY KEY,
  offering_id bigint REFERENCES session_offerings(id),   -- ← NO index created
  ...
);
```

Two consequences, and the second one is a real outage waiting to happen:

1. `SELECT * FROM bookings WHERE offering_id = 5` does a seq scan.
2. `DELETE FROM session_offerings WHERE id = 5` must check every child row for
   references — a **full scan of `bookings` per deleted parent row**, while holding
   locks.

MySQL/InnoDB creates that child index for you. Postgres does not. Index every foreign
key column unless you have a specific reason not to.

---

## 10. Clustered vs secondary — Postgres vs InnoDB

Same `CREATE INDEX`, materially different physics. Worth knowing before you pick an
RDS engine.

**PostgreSQL — heap-organised.** The table is an unordered heap (§1). *Every* index is
a secondary index pointing at a ctid. The primary key has no special storage role at
all; it is just a unique index you happened to name.

**MySQL / InnoDB — index-organised.** The table **is** the primary key's B+Tree: rows
are stored *inside* the PK's leaves, in PK order. Secondary indexes therefore cannot
store a physical location (rows move when pages split) — they store the **primary key
value**, and every secondary lookup does two descents:

```text
  Postgres                          InnoDB
  ────────────────────────          ─────────────────────────────────────
  idx_email → ctid → heap page      idx_email → PK value → descend PK tree → row
     (1 tree + 1 page read)             (2 trees)
```

Three practical consequences if you land on MySQL:

- **Keep the primary key small.** It is copied into *every* secondary index. A 16-byte
  UUID PK versus an 8-byte bigint costs you 8 extra bytes × every row × every index.
- **Keep the primary key monotonically increasing.** Inserting random UUIDs into a
  clustered index means inserting into the *middle of the table* constantly — page
  splits, fragmentation, cache misses. `bigint` auto-increment, or UUIDv7 (which is
  time-ordered), avoids this. This is a real, measurable difference; it is the single
  most common self-inflicted MySQL performance wound.
- **A covering secondary index is worth more**, because it skips the second descent
  entirely.

Postgres does not have clustered indexes. Its `CLUSTER` command is a **one-time**
physical reorder that is not maintained afterwards — do not confuse the two.

On UUIDs generally: random UUIDv4 primary keys hurt *both* engines (in Postgres they
destroy index locality and inflate WAL), just less catastrophically. If you want
opaque public ids, either use `bigint` PKs plus a separate public id column, or use
UUIDv7.

---

## 11. Pagination — the index problem nobody warns you about

Your feed and your messages both paginate. The obvious implementation is quadratic and
will feel fine right up until it doesn't.

```sql
-- ❌ OFFSET pagination
SELECT * FROM posts ORDER BY created_at DESC LIMIT 20 OFFSET 10000;
```

The database cannot *skip* 10,000 rows. It must **produce and discard** them. Page 1
reads 20 rows; page 500 reads 10,020 and throws away 10,000. Cost grows linearly with
page number, and the deeper users scroll the slower it gets — precisely backwards from
what you want on an infinite-scroll feed.

```sql
-- ✅ Keyset / "seek" pagination — remember where you stopped
SELECT * FROM posts
 WHERE (created_at, id) < ($1, $2)     -- last row of the previous page
 ORDER BY created_at DESC, id DESC
 LIMIT 20;

CREATE INDEX idx_posts_keyset ON posts (created_at DESC, id DESC);
```

This descends the tree straight to the cursor position and reads 20 leaf entries.
**Page 500 costs exactly what page 1 costs.** The row-value comparison `(a, b) < (x, y)`
is the important detail — it maps directly onto the composite index order, whereas
`created_at < $1 OR (created_at = $1 AND id < $2)` does not.

The trade: you cannot jump to "page 47", only forwards and backwards. For a feed,
messages, or notifications — infinite scroll, never numbered pages — that is not a
loss. Include a tiebreaker column (`id`) so the order is *total*; without it, rows
sharing a timestamp can be skipped or duplicated across page boundaries.

---

## 12. Reading EXPLAIN — the only skill that actually matters

Everything above is theory you will misapply until you can read a plan. This is the
feedback loop: **never optimise an index without a before-and-after plan.**

```sql
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT * FROM bookings WHERE provider_id = 7 AND starts_at > now();
```

- `EXPLAIN` alone → the planner's *estimate*, without running anything.
- `ANALYZE` → **actually runs the query** and reports real times and row counts.
  (Wrap it in `BEGIN; … ROLLBACK;` if the statement writes.)
- `BUFFERS` → page reads, hits and misses. This is the §1 cost unit, made visible.

### Before

```text
Seq Scan on bookings  (cost=0.00..24418.00 rows=41 width=97)
                      (actual time=0.412..184.221 rows=38 loops=1)
  Filter: ((provider_id = 7) AND (starts_at > now()))
  Rows Removed by Filter: 999962          ◄── read a million rows to return 38
  Buffers: shared read=12345
Execution Time: 184.9 ms
```

### After `CREATE INDEX ON bookings (provider_id, starts_at)`

```text
Index Scan using idx_bookings_provider_start on bookings
                      (cost=0.42..8.61 rows=41 width=97)
                      (actual time=0.021..0.043 rows=38 loops=1)
  Index Cond: ((provider_id = 7) AND (starts_at > now()))   ◄── both in the tree
  Buffers: shared hit=6
Execution Time: 0.078 ms
```

**2,400× faster**, and the reason is legible: 12,345 page reads became 6.

### The five things to actually look at

| Signal | What it means | What to do |
|---|---|---|
| `Seq Scan` on a big table with a selective filter | no usable index, or §7 | fix sargability, or add the index |
| **`Rows Removed by Filter:` large** | the index found rows the engine then threw away | move that column *into* the index |
| **`Index Cond:` vs `Filter:`** | `Index Cond` = used to descend the tree. `Filter` = checked afterwards | get your predicates into `Index Cond` |
| **estimated `rows=` ≫ or ≪ actual** | statistics are stale or correlated | `ANALYZE`; consider extended statistics |
| `Sort` + `Sort Method: external merge Disk:` | ordering not served by an index, spilling to disk | add the `ORDER BY` columns to the index |
| `Heap Fetches:` large on an index-only scan | visibility map is stale (§6) | `VACUUM` the table |

> **The single most useful line in any plan is `Rows Removed by Filter`.** It is the
> exact count of work the database did for nothing. Driving that number to zero is
> what index tuning *is*.

Paste the plan into <https://explain.dalibo.com/> when it gets nested — it renders the
tree and highlights where the time and the misestimates actually went.

---

## 13. The same ideas in MongoDB and DynamoDB

Your `docs/03-system-design.md` still has "AWS Cloud DB" as a TODO across
RDS/Aurora, DocumentDB and DynamoDB. Indexing is the dimension where that choice
bites hardest, so here is the comparison in the terms of §1–§12.

### MongoDB / DocumentDB — B-trees with different syntax

Almost everything transfers. Mongo indexes are B-trees; leftmost-prefix and E-S-R
apply unchanged.

```js
// composite index — same ordering rules as §5
db.bookings.createIndex({ providerId: 1, status: 1, startsAt: 1 })

// partial index — §8
db.notifications.createIndex(
  { userId: 1, createdAt: -1 },
  { partialFilterExpression: { readAt: null } }
)

// unique compound — §9, the follow relationship
db.follows.createIndex({ followerId: 1, followingId: 1 }, { unique: true })

// TTL index — no SQL equivalent: documents self-delete
db.sessions.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })

db.bookings.find({ providerId: 7 }).explain("executionStats")
```

Mongo-specific things to know:

- **`_id` is always indexed**, always unique, and you cannot drop it.
- **Multikey indexes**: index an array field and Mongo indexes each element — the
  equivalent of GIN. One caveat: an index can be multikey on at most one array field
  per compound index.
- **`explain("executionStats")`** is your `EXPLAIN ANALYZE`. Read `totalKeysExamined`
  vs `totalDocsExamined` vs `nReturned`. Healthy is `keys ≈ docs ≈ returned`;
  `docsExamined ≫ nReturned` is §12's "Rows Removed by Filter" wearing a different hat.
- **`COLLSCAN` in `winningPlan.stage`** = sequential scan.
- The **ESR rule** in §5 is literally MongoDB's own documented guidance.
- **DocumentDB is not MongoDB.** It is an AWS reimplementation of the wire protocol;
  index-type coverage and `explain` output differ from real MongoDB in ways that will
  surprise you. If you go this route, verify each index type you depend on.

### DynamoDB — a completely different bargain

This is the one that will break your mental model, so it is worth being explicit.
DynamoDB does not have a planner. It has **no sequential scan you would ever want to
run**. There is no "add an index later and the same query gets faster."

```text
  PARTITION KEY (PK)  → hashed to choose a physical partition. Equality ONLY.
  SORT KEY      (SK)  → sorted WITHIN one partition. Ranges, begins_with, ORDER BY.
```

Every `Query` **must** supply an exact partition key. That single rule cascades into
everything else:

| Concept | Relational | DynamoDB |
|---|---|---|
| Ad-hoc query on any column | planner figures it out | **impossible** without an index for it |
| Add an index later | `CREATE INDEX`, done | GSI, yes — LSI, **only at table creation** |
| Query without index | slow (seq scan) | `Scan` — reads the whole table and bills you |
| Design order | model the data, then index | **model the access patterns, then the keys** |

- **LSI (Local Secondary Index)** — same PK, different SK. Created *only* with the
  table, and caps that partition's item collection at 10 GB. Supports strongly
  consistent reads.
- **GSI (Global Secondary Index)** — a *different* PK and SK. Effectively a separate,
  asynchronously-replicated table with its own capacity. Always eventually consistent.
  This is the workhorse.

Your `follows` relationship shows the shape clearly. In SQL, two indexes on one table
answer both directions. In DynamoDB you invert the key:

```text
  base table   PK = followerId    SK = followingId   →  "who does Teja follow?"
  GSI1         PK = followingId   SK = followerId    →  "who follows Teja?"
```

That is **single-table design**: you enumerate access patterns first, then reverse-
engineer keys and GSIs that serve each one. It is genuinely powerful at scale and
genuinely unforgiving when requirements change.

### The recommendation for 1on1, stated plainly

Your system design calls for a followed-users feed with ranking, a 9-filter search,
availability overlap checks, and a booking flow with a documented race condition.
Those are **relational, multi-dimensional, ad-hoc query patterns** — exactly the shape
DynamoDB punishes and Postgres was built for. §9's exclusion constraint alone is not
expressible in DynamoDB without an external lock.

> **Pick RDS or Aurora PostgreSQL.** You get B-tree, GIN, GiST, BRIN, partial and
> expression indexes, real transactions, exclusion constraints, and the freedom to add
> an index in month six for a query you have not thought of yet. Revisit DynamoDB only
> for a specific, high-volume, known-key-pattern workload (presence, or a chat message
> log), not as the primary store.

### ✅ Decided — RDS PostgreSQL, 2026-09-06

This is no longer a recommendation. Teja chose **RDS PostgreSQL**; the decision is
recorded in the root `CLAUDE.md` and is authoritative for the whole repo.

The stated reasoning matches the argument above and adds one this document could not
have known: `1on1_sb` already has **proven Flyway migrations for this exact product**,
so the data modelling transfers directly rather than being redone. Free-tier window
runs to 2027-08-27.

Worth recording honestly, because it is the more interesting half of the story: an AWS
CLI audit across all 17 regions found **zero databases** in the account — no RDS,
Aurora, DynamoDB, DocumentDB, ElastiCache or S3. The "AWS-hosted cloud database" that
appears throughout the older docs was never a provisioned resource, only an intention.
`1on1_sb`'s PostgreSQL ran unmanaged on its EC2 box. So this was a decision to *make*,
not a fact to look up — which is exactly why the fork above was presented as a fork.

**What that settles for the rest of this document:** everything in §1–§12 was already
Postgres-shaped and is now unconditionally correct for this project. §14 is live.

---

## 14. The actual 1on1 index plan

> **Settled and live.** The database is **RDS PostgreSQL**, decided 2026-09-06 (§13).
> Everything below is directly runnable rather than conditional — these are the
> indexes to put in the first migration. Peer session `1on1-18` is designing the
> actual schema at `../architecture/01-data-model.md`, porting `1on1_sb`'s Flyway
> migrations; the column names there win over the illustrative ones here, but the
> index *shapes* and the reasoning for each should match.

Derived from the access patterns in `03-system-design.md`, not from the tables —
which is the method, and the point of this section.

> **The method:** write down the queries you will actually run, one per line, then
> design the minimum set of indexes that covers them. Never the reverse. An index you
> cannot name a query for is an index you should not create.

```sql
-- ── users ───────────────────────────────────────────────────────────────────
-- login by email; case-insensitive uniqueness (§4 signup, §7 expression index)
CREATE UNIQUE INDEX idx_users_email_lower ON users (LOWER(email));
-- Google OAuth account linking (§5). Partial: most users have no google_sub.
CREATE UNIQUE INDEX idx_users_google_sub ON users (google_sub)
    WHERE google_sub IS NOT NULL;
-- public profile URLs
CREATE UNIQUE INDEX idx_users_handle ON users (LOWER(handle));

-- ── search (§8) ─────────────────────────────────────────────────────────────
CREATE INDEX idx_users_skills   ON users USING gin (skills);        -- text[]
CREATE INDEX idx_users_search   ON users USING gin (search_doc);    -- tsvector
CREATE INDEX idx_users_provider ON users (city, hourly_rate)        -- partial:
    WHERE is_provider;                                              -- providers only

-- ── follows (§6) ────────────────────────────────────────────────────────────
-- the PK enforces "cannot follow twice" AND serves "who does X follow?"
ALTER TABLE follows ADD PRIMARY KEY (follower_id, following_id);
-- the reverse direction needs its own index — a PK prefix only works left-to-right
CREATE INDEX idx_follows_reverse ON follows (following_id, follower_id);

-- ── posts / feed (§7) ───────────────────────────────────────────────────────
-- fan-out-on-read: WHERE author_id = ANY(followed) ORDER BY created_at DESC
CREATE INDEX idx_posts_author_time ON posts (author_id, created_at DESC);
-- keyset pagination for infinite scroll (§11)
CREATE INDEX idx_posts_keyset ON posts (created_at DESC, id DESC);

-- ── session offerings (§9) ──────────────────────────────────────────────────
CREATE INDEX idx_offerings_provider ON session_offerings (provider_id)
    WHERE is_published;
CREATE INDEX idx_offerings_title_trgm
    ON session_offerings USING gin (title gin_trgm_ops);            -- ILIKE '%x%'

-- ── availability (§10) ──────────────────────────────────────────────────────
CREATE INDEX idx_availability_provider ON availability (provider_id, day_of_week);

-- ── bookings (§9, §11, §12) ─────────────────────────────────────────────────
-- provider dashboard: E, E, R  (§5)
CREATE INDEX idx_bookings_provider ON bookings (provider_id, status, starts_at);
-- seeker's own list
CREATE INDEX idx_bookings_seeker   ON bookings (seeker_id, starts_at DESC);
-- FK child column — Postgres does NOT create this (§9)
CREATE INDEX idx_bookings_offering ON bookings (offering_id);
-- the reminder job: "what starts in the next 15 minutes?"  partial keeps it tiny
CREATE INDEX idx_bookings_upcoming ON bookings (starts_at)
    WHERE status = 'confirmed';
-- CORRECTNESS, not speed: no overlapping active bookings per provider (§9)
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE bookings ADD CONSTRAINT bookings_no_overlap
  EXCLUDE USING gist (provider_id WITH =, tstzrange(starts_at, ends_at) WITH &&)
  WHERE (status IN ('pending','confirmed'));

-- ── messages (§17) ──────────────────────────────────────────────────────────
-- load a conversation, newest first, keyset-paginated
CREATE INDEX idx_messages_convo ON messages (conversation_id, created_at DESC, id DESC);
-- unread badge counts only ever look at undelivered rows
CREATE INDEX idx_messages_unseen ON messages (recipient_id)
    WHERE seen_at IS NULL;

-- ── notifications (§26) ─────────────────────────────────────────────────────
CREATE INDEX idx_notifications_unread ON notifications (user_id, created_at DESC)
    WHERE read_at IS NULL;

-- ── certificates (§25) ──────────────────────────────────────────────────────
-- the public verification endpoint is a single point lookup by hash
CREATE UNIQUE INDEX idx_certificates_hash ON certificates (sha256_hash);
```

Three things to notice about that list, because they are the transferable lessons:

1. **Six of them are partial.** Almost every index on a table with a lifecycle column
   (`status`, `read_at`, `seen_at`, `is_published`) should be partial. You index the
   rows you query, not the rows you keep.
2. **`follows` needs both directions explicitly.** "Who follows me" is not a prefix of
   "who do I follow". This is the leftmost-prefix rule (§5) costing you a real index.
3. **One entry is a constraint, not an optimisation.** The exclusion constraint exists
   to make a class of bug impossible, and the index is the mechanism.

---

## 15. Operating indexes in production

### Creating without locking the table

`CREATE INDEX` takes a lock that blocks **writes** for the whole build. On a large
table that is an outage.

```sql
CREATE INDEX CONCURRENTLY idx_bookings_seeker ON bookings (seeker_id, starts_at DESC);
```

`CONCURRENTLY` builds in two passes and does not block writes. The costs: it is
slower, it cannot run inside a transaction block (so most migration tools need an
escape hatch), and **if it fails it leaves an `INVALID` index behind** that you must
drop manually.

```sql
-- find failed concurrent builds
SELECT indexrelid::regclass FROM pg_index WHERE NOT indisvalid;
DROP INDEX CONCURRENTLY idx_bookings_seeker;   -- also concurrent
```

### Finding indexes nobody uses

```sql
SELECT relname AS table,
       indexrelname AS index,
       idx_scan AS times_used,
       pg_size_pretty(pg_relation_size(indexrelid)) AS size
  FROM pg_stat_user_indexes
 WHERE idx_scan = 0
   AND NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conindid = indexrelid)
 ORDER BY pg_relation_size(indexrelid) DESC;
```

`idx_scan = 0` after a representative period (a month, spanning your monthly jobs)
means the index is pure write-cost and cache pressure (§3.3). Drop it. Exclude
constraint-backing indexes, which may show zero scans while still enforcing
correctness — dropping those is a data-integrity bug, not a cleanup.

Note that these counters are cluster-wide and survive restarts but reset on
`pg_stat_reset()`; check `stats_reset` before trusting a low number. And on a
primary/replica setup, an index used only by read replicas will look unused on the
primary.

### Finding the queries worth indexing

```sql
CREATE EXTENSION pg_stat_statements;   -- add to shared_preload_libraries

SELECT calls, round(mean_exec_time::numeric, 2) AS avg_ms,
       round(total_exec_time::numeric) AS total_ms, query
  FROM pg_stat_statements
 ORDER BY total_exec_time DESC LIMIT 20;
```

Order by **total** time, not mean. A 5 ms query called 2 million times costs more than
a 3-second report run twice a day, and it is usually the one an index fixes.

### Bloat and rebuilds

Postgres indexes accumulate dead entries under heavy update/delete. Symptoms: index
size grows while row count does not; queries slowly get worse. Fix:

```sql
REINDEX INDEX CONCURRENTLY idx_posts_author_time;   -- PG 12+
```

Autovacuum handles the steady state. If you are reindexing routinely, autovacuum is
under-tuned for that table — fix the cause, not the symptom.

### The migration discipline

Indexes belong in versioned migration files alongside the tables, reviewed like code.
Never `CREATE INDEX` by hand on production — that index will not exist in staging, and
six months later nobody will know why prod is fast and staging is not.

---

## 16. Anti-patterns and myths

| Belief | Reality |
|---|---|
| "Index every column in the WHERE clause" | Composite beats several singles (§5). Many singles = write cost with little benefit |
| "More indexes = faster database" | Faster reads, slower writes, more cache pressure, slower planning (§3) |
| "The index isn't used, so it's broken" | The planner probably chose correctly (§4). Read the plan before acting |
| "Primary key indexing is enough" | It serves lookups by id. Nothing else in §14 is by id |
| "Index the boolean `is_active`" | ~50% selectivity — useless. Use a partial index instead (§8) |
| "Order the composite columns by cardinality" | Order by **usage**: E-S-R (§5). Cardinality is a tiebreaker at best |
| "`OR` works fine" | `OR` across two columns often can't use one tree. `UNION ALL` frequently wins (§7) |
| "`SELECT *` is fine, it's just columns" | It defeats index-only scans (§6) and inflates I/O for no reason |
| "`count(*)` should be instant, it's indexed" | Postgres MVCC must check visibility. Large exact counts are slow; estimate or cache |
| "Add indexes at the end, before launch" | Add them when you write the query. You will not remember the access pattern later |
| "The ORM handles indexing" | ORMs generate indexes for PKs, uniques and sometimes FKs. Nothing composite, nothing partial |
| "It's fast on my machine" | 500 seeded rows fit in one page. Every plan is fast. Test with realistic volume |

That last one deserves a sentence of its own, because it is the one that will actually
get you. **A sequential scan of a small table is fast.** You will never see a
performance problem in development. Seed a realistic volume — 100k users, 1M posts,
5M messages — before you trust any measurement or any plan.

---

## 17. Cheat sheet

```text
  ┌─ IS AN INDEX WORTH IT? ────────────────────────────────────────────────┐
  │                                                                        │
  │  Does a real query filter/join/sort on this?  ── no ──▶ don't create it │
  │            │ yes                                                       │
  │  Does it return < ~5-10% of the table?  ── no ──▶ seq scan wins anyway  │
  │            │ yes                                                       │
  │  Is the column bare in the predicate?   ── no ──▶ fix §7 sargability    │
  │            │ yes                                                       │
  │  Is it a prefix of an index I already have? ── yes ──▶ already covered  │
  │            │ no                                                        │
  │            ▼                                                           │
  │  CREATE INDEX CONCURRENTLY, ordered E → S → R, partial if a lifecycle   │
  │  column exists, INCLUDE the returned columns if the query is hot.      │
  │  Then EXPLAIN (ANALYZE, BUFFERS) before and after.                     │
  └────────────────────────────────────────────────────────────────────────┘
```

**The nine sentences worth memorising**

1. The unit of cost is the **page read**, not the row.
2. A B+Tree lookup is ~3–4 page reads at any table size — so a slow query means the
   index is *not being used*, not that it is *too small*.
3. Every index makes reads faster and **writes slower**. Count them on hot paths.
4. Column order in a composite index is **E → S → R**, and `(a,b,c)` already serves
   `(a,b)` and `(a)`.
5. An index gives you `ORDER BY` for free. That is often the bigger win.
6. Wrap the column in a function and you have turned the index off (§7).
7. Low-cardinality column? Use a **partial index**, not a plain one.
8. `UNIQUE` and `EXCLUDE` indexes are **correctness primitives** — they are how you fix
   check-then-insert races, including your booking bug.
9. **`Rows Removed by Filter`** is the amount of work you did for nothing. Drive it to
   zero.

**When something is slow, in order**

```text
  1. EXPLAIN (ANALYZE, BUFFERS)     — never guess
  2. Seq Scan on a big table?       — is the predicate sargable (§7)?
  3. Rows Removed by Filter large?  — move that column into the index (§5)
  4. Sort node present?             — put ORDER BY columns in the index (§2)
  5. Estimate ≠ actual?             — ANALYZE the table (§4)
  6. Heap Fetches large?            — VACUUM (§6)
  7. Still slow?                    — the query shape is wrong, not the index
```

---

## Related

- [`../03-system-design.md`](../03-system-design.md) — §6 follows, §7 feed, §8 search,
  §9–12 sessions and bookings, §17 messaging, §26 notifications. Every index in §14
  traces back to one of those sections.
- [`../03-system-design.md`](../03-system-design.md) §11 — the booking race condition
  that §9 of this document actually solves.
- [`../02-technology-stack.md`](../02-technology-stack.md) §1 — where the AWS database
  decision from §13 should be recorded.
- [`../code/03-backend.md`](../code/03-backend.md) — the backend as it stands: one
  Express file, no data layer yet. This document is what to build against when it
  gains one.
- [`03-loop-engineering.md`](03-loop-engineering.md) — `EXPLAIN (ANALYZE)` is a gate in
  exactly that document's sense: a command that answers "did that work?" with evidence
  instead of an opinion. Index tuning without a before/after plan is a loop with no
  OBSERVE step.
