# 09 — Stack Correction, 2026-09-05

> A changelog, not a design document. It records a factual correction applied
> across `docs/**` on 2026-09-05, so that anyone reading an older revision of
> these files knows what was wrong and why it changed.

**Applies to:** `docs/01-product-requirements.md`, `docs/02-technology-stack.md`,
`docs/03-system-design.md`, `docs/code/03-backend.md`, `docs/code/04-frontend.md`,
`docs/code/06-dependencies.md`, `docs/code/07-ci-and-security.md`,
`docs/code/08-gaps-and-findings.md`, `docs/learn/03-loop-engineering.md`.

---

## 1. The correction, in Teja's words

> *"this current project is only node based more like in to mern stack without
> mongo db instead we use awscloub db (update this in docs too) so no more
> spring boot and java"*

Unpacked into four facts the docs now assert:

1. **`1on1` is Node.js end to end.** MERN-shaped, but with the M replaced.
   Backend is Node + Express (ESM), confirmed by `backend/package.json` and
   `backend/src/server.js`.
2. **MongoDB is not the database.** An AWS-hosted cloud database is.
   Commit `8155e4d` *"docs, code commenting, mongodb to aws db"* is where the
   migration actually happened; the docs had simply not caught up.
3. **There is no Java and no Spring Boot in this project — anywhere.**
4. **The frontend adopted TypeScript on 2026-09-05.** React + Vite + TypeScript,
   with `react-router-dom` v7.

### 1.1 The `1on1_sb` confusion — do not repeat it

Teja maintains a **separate parallel repo, `1on1_sb`, which does use Java and
Spring Boot.** That is a different project. Its *UI* was ported into this repo
(the Landing / Login / Register pages, rewritten as React + TypeScript), but
**none of its backend stack came with it.** If a future doc pass finds a Spring
reference in `1on1`, the answer is always "that belongs to `1on1_sb`", never
"1on1 must be a Spring app".

---

## 2. What was stale

| Where | Stale claim | Now says |
|---|---|---|
| `02-technology-stack.md` §1 | "MongoDB Atlas", "Mongoose" as the database stack | "AWS-hosted cloud database (managed)" + a TODO for the exact service |
| `02-technology-stack.md` §2 | Required skills include "MongoDB/Mongoose query concepts" | "Query concepts for the AWS-hosted cloud database" |
| `02-technology-stack.md` §9, §16–§22 | Data model written in MongoDB vocabulary | Kept verbatim, but flagged with TODOs — see §4 below |
| `02-technology-stack.md` §14 | "The frontend should not directly access MongoDB" | "…should not directly access the database. All data access goes through the Express REST API" — **the principle was the point and was preserved** |
| `02-technology-stack.md` §32, §37 | "MongoDB Atlas remains an external managed database"; growth order starts at MongoDB | AWS-hosted cloud database, plus a TODO about the AWS-DB / GCP-hosting cross-cloud split |
| `01-product-requirements.md` | Agent-tool authorization chain and notification persistence both ended at MongoDB | AWS-hosted cloud database |
| `03-system-design.md` | "MongoDB Atlas" in the architecture diagram and ~10 flow diagrams; "MongoDB query / Atlas Search"; "MongoDB URI" env var | "AWS Cloud DB" / "Database query / search index" / "Database connection URI", with a document-level TODO at the top |
| `code/03-backend.md` | Gap analysis measured against "MongoDB Atlas + Mongoose"; roadmap step 3 said "Connect MongoDB via Mongoose" | AWS-hosted cloud database, with step 3 explicitly marked blocked on the service choice |
| `code/06-dependencies.md` | Planned-stack table listed MongoDB Atlas + Mongoose; `pnpm add mongoose` used as the worked example in the install cheatsheet | AWS-hosted cloud database + "DB client / ODM-ORM (depends on the service)"; the cheatsheet example is now `jsonwebtoken` |
| `code/08-gaps-and-findings.md` | "Mongo URI" as the example secret; "MongoDB Atlas + Mongoose" delta row | AWS database URI; "AWS-hosted cloud database + its client" |
| `code/04-frontend.md` | `fetch('/api/login')` | `fetch('/api/auth/login')` |
| `learn/03-loop-engineering.md` | `POST /api/login` in 10 places | `POST /api/auth/login`, matching `learn/04-graph-engineering.md:451` and the shipped frontend |

**References corrected: 64**, counted against `HEAD` (`6703c84`):

- **54 MongoDB-family references eliminated.** `HEAD` contained 59 occurrences of
  `MongoDB` / `Mongoose` / `Mongo` / `Atlas` across six files
  (`01`: 2, `02`: 15, `03`: 17, `code/03`: 13, `code/06`: 8, `code/08`: 4).
  Five remain — 3 in `02` and 2 in `03` — and **every one of them is a newly
  written negative statement or a historical TODO** (see §2.2). Zero survive as a
  factual claim about the stack.
- **10 API-path replacements**, all in `learn/03-loop-engineering.md`
  (`/api/login` → `/api/auth/login`).
- Plus the TypeScript / react-router / ESLint-`--ext` factual updates in `code/04`,
  `code/06`, `code/07` and `code/08`.

### 2.1 What the interrupted previous agent had already done

A previous session did most of the MongoDB → AWS renaming in
`01-product-requirements.md`, `02-technology-stack.md`, `03-system-design.md`,
`code/03-backend.md`, `code/04-frontend.md` and `code/06-dependencies.md`, then
stopped before writing this file. Its renames were correct and were kept.

**It did leave one defect, now fixed:** five inserted blocks had been written
twice, producing duplicated paragraphs in
`02-technology-stack.md` (the TypeScript-port note and the canonical-auth-endpoints
note), `03-system-design.md` (the top-of-file TODO), `code/03-backend.md` (the
roadmap step-3 TODO) and `code/06-dependencies.md` (the AWS-service TODO). Each
duplicate was removed. A full duplicate-paragraph scan across `docs/**` now comes
back clean.

It had also **not** touched `learn/03-loop-engineering.md`,
`code/07-ci-and-security.md` or `code/08-gaps-and-findings.md` at all.

### 2.2 Stale-term hits deliberately left in place

A sweep for `MongoDB`, `mongo`, `mongoose`, `Atlas`, `Java`, `Spring`,
`Spring Boot`, `JPA`, `Hibernate`, `Maven`, `Bean Validation` and `BCrypt` leaves
these, all intentional:

- **Negative statements.** `02-technology-stack.md:28` ("There is no MongoDB in
  this project… no Java, no Spring Boot"), `:114` ("there is no Spring
  Security…"), `:124` (why `/api/auth/google` and not
  `/oauth2/authorization/google`), and `code/04-frontend.md:30` (the `1on1_sb`
  disclaimer). These exist precisely so the mistake does not get made again.
- **Historical TODOs.** `02-technology-stack.md:398` and `03-system-design.md:34`
  say the surrounding guidance *was written against MongoDB* — that is true and
  is the reader's warning.
- **Generic CodeQL documentation.** `code/07-ci-and-security.md:154` lists
  CodeQL's accepted `language:` values (which include `java-kotlin`) and `:162`
  is a general table of compiled languages. Neither claims this project uses
  Java. Removing accurate third-party reference material would make the doc
  worse, so they stay.
- **`bcrypt`.** Every hit is the **Node** `bcrypt` / `bcryptjs` package, which is
  the correct choice for this stack. It was never a Java-library reference.

---

## 3. The TypeScript port (same day, separate change)

The docs had claimed a TypeScript stack while the code was plain `.jsx` — a
long-standing known gap recorded in `code/08-gaps-and-findings.md` §6. **That gap
is now closed on the frontend.** Verified against the working tree:

- `typescript@^5.9.2` and `react-router-dom@^7.9.1` are real dependencies.
- `tsconfig.json`, `tsconfig.app.json`, `tsconfig.node.json` exist.
- `build` is `tsc -b && vite build`; `typecheck` is its own script; `lint` is now
  `--ext js,jsx,ts,tsx`.
- Landing, Login and Register were ported from `1on1_sb` into
  `frontend/src/pages/{Landing,Login,Register}.tsx`, with
  `frontend/src/components/` (`AuthShell`, `Brand`, `Icons`, `SlotBlock`,
  `TextField`) and `frontend/src/lib/` (`api.ts`, `auth.tsx`, `types.ts`,
  `validate.ts`).

**The backend was not ported.** It is still plain ESM JavaScript.

Because `code/04-frontend.md` is a line-by-line walkthrough of the *old* `.jsx`
frontend, it was **not** rewritten — a dated STATUS banner was added at the top
instead, saying exactly which parts are now stale. Rewriting it before the entry
point is switched (see §4) would only have to be done twice.

### 3.1 Auth contract (unchanged, and re-anchored to Express)

Preserved exactly as designed, with the only edit being that nothing attributes
it to Spring Security:

- Email + password is the core credential. No phone auth.
- Short-lived JWT access token, **held in memory only** — never `localStorage`.
- Refresh token in an **HTTP-only cookie**; requests send
  `credentials: "include"`.
- `bcrypt` hashing, server-side.
- Google OAuth is **optional and additive** — it never replaces email + password.
- **Clerk remains explicitly forbidden** in the current implementation.

Canonical endpoints are `POST /api/auth/register`, `POST /api/auth/login`,
`POST /api/auth/refresh`, matching `frontend/src/lib/api.ts`.

### 3.2 Endpoints are a contract, not shipped behaviour

`backend/src/server.js` implements **exactly one route: `GET /api/health`.** No
auth endpoint exists yet. Every doc that names an auth endpoint now says so
rather than implying the route works. `frontend/src/lib/api.ts` already calls
them and degrades through its network-error path — deliberate; the UI landed
first.

---

## 4. Open TODOs left for Teja

These are decisions, not omissions. Each is marked with a visible `> **TODO:**`
callout at the point in the docs where it bites.

| # | Open question | Where it is flagged |
|---|---|---|
| **1** | **Which AWS database service?** RDS / Aurora / DynamoDB / DocumentDB. *Nothing was guessed.* Every other database mention points back to one line. | `02-technology-stack.md` §1 (the anchor), `03-system-design.md` §1, `code/03-backend.md` §7, `code/06-dependencies.md` |
| **2** | **Is the data model still document-shaped?** §16–§22 of `02-technology-stack.md` (and §9's "Recommended collections") are written in MongoDB vocabulary — collections, embedded documents, compound indexes. They were **not** silently rewritten. If the chosen service is relational they need a real pass. | `02-technology-stack.md` §9 and §16; `03-system-design.md` §1 (covers the "Follow collection" flow) |
| **3** | **Is AWS-database + GCP-hosting the intended split?** The deployment section still targets GCP for the app while the database moved to AWS. | `02-technology-stack.md` §32 |
| **4** | **What is the real Google OAuth route?** `frontend/src/lib/api.ts` points at `/api/auth/google` with a matching TODO in the source, chosen only because the Spring convention `/oauth2/authorization/google` does not exist in Express. The callback path is also unsettled. | `02-technology-stack.md` §3 |
| **5** | **Finish the frontend entry-point switch.** `frontend/index.html` still loads `/main.jsx` and there is no `src/main.tsx`, so `main.jsx` → `app.jsx` → `src/pages/login.jsx` is still the live chain and the `.tsx` pages are **not mounted**. `react-router-dom` is installed but no `<BrowserRouter>` is rendered. | `code/04-frontend.md` (STATUS banner), `code/08-gaps-and-findings.md` §3.3 and §6 |
| **6** | **Delete the dead `.jsx` files — or don't.** `frontend/main.jsx`, `frontend/app.jsx`, `frontend/src/pages/{landingpage,login,register}.jsx` and `frontend/src/pages/login.css` are on disk. Once #5 lands they are dead weight. Left in place deliberately: deleting a peer session's files was out of scope. | `code/04-frontend.md` (STATUS banner) |
| **7** | **Re-derive `code/04-frontend.md` §§2–7** once #5 and #6 are settled — the file tree, render chain, and the "no router / no API calls / no TypeScript" rows in §1 all change. | `code/04-frontend.md` (STATUS banner) |

### 4.1 A note on why nothing was invented

Teja said "aws cloud db" without naming a service. The docs therefore say
**"AWS-hosted cloud database"** everywhere and name no service. A visible TODO is
worth more than a confident wrong answer — a doc that says "DynamoDB" would send
someone shopping for the wrong driver, the wrong data model and the wrong
consistency guarantees, and nothing in the repo would contradict it.

The same rule was applied to the data model: guidance that depends on the
database being document-oriented was **flagged, not rewritten**. Data-model
decisions belong to Teja.

---

## 5. Scope of this pass

**Changed:** `docs/**` only.

**Not changed:** `frontend/**` and `backend/**` were read for verification and
never written — concurrent sessions own those. Nothing was committed or pushed;
all edits are left in the working tree for Teja to review and commit himself.

**Also not changed — written concurrently by another session:**
`docs/learn/06-database-indexing.md` (new) and the block added to
`docs/learn/00-index.md` that links it. They appeared mid-pass and were left
untouched. They are **consistent with this correction**: `06` opens by stating the
database choice has *not* been decided, cites the `03-system-design.md` §1 TODO by
name, and contains no Java or Spring. Its MongoDB mentions are legitimate — §13
compares index behaviour across the RDS/Aurora, DocumentDB and DynamoDB candidates,
which is exactly the open question in TODO #1 above, not a stale claim.

The `.pdf` files beside `01`, `02` and `03` were **not** regenerated and still
carry the old MongoDB text. Re-export them from the corrected Markdown when
convenient.
