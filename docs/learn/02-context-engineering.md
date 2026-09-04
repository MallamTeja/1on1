# Context Engineering — managing what the model can actually see

> **The one-sentence version:** the prompt is what you *say*; the context is what I
> can *see*. You can write a perfect prompt and still get garbage if the context is
> wrong — and context is the lever you control most and think about least.

---

## 1. The mental model

A language model has no memory, no filesystem access, and no idea what your project
is. It has **one input**: a block of tokens. That block is the context window.

```text
┌──────────────────── CONTEXT WINDOW (a fixed token budget) ────────────────────┐
│                                                                               │
│  [system prompt]   who I am, what tools exist, house rules                    │
│  [project memory]  CLAUDE.md, skills, memories                                │
│  [conversation]    every message you sent, every reply I gave                 │
│  [tool results]    every file I read, every command's stdout ← THE BIG ONE    │
│  [your prompt]     the thing you just typed                                   │
│                                                                               │
└───────────────────────────────────────────────────────────────────────────────┘
```

Two consequences that explain almost every frustration people have with AI agents:

1. **If it is not in the window, it does not exist.** I cannot "look something up"
   unless I run a tool and the result lands in the window.
2. **The window is finite and shared.** Every wasted token is a token unavailable
   for reasoning. A 130,000-line lockfile dumped into context does not just waste
   space — it *dilutes* everything else in it.

> Prompt engineering optimises the **instruction**.
> Context engineering optimises the **evidence**.
> The second one is where most real quality lives.

---

## 2. The four failure modes

| Failure | What it looks like | Root cause |
|---|---|---|
| **Starvation** | Confident answers about files I never read. Invented function names. | Not enough context |
| **Pollution** | Wrong-but-plausible output; I "remember" something from 40 messages ago that is no longer true | Stale/irrelevant context |
| **Dilution** | Quality quietly degrades in long sessions; I miss instructions you definitely gave | Too much context; signal-to-noise collapse |
| **Fragmentation** | Two agents produce contradictory docs | Context split across workers with no shared ground truth |

**Starvation causes hallucination. Dilution causes drift.** They have opposite fixes,
which is why "just give it more context" is bad advice as often as it is good.

---

## 3. What I actually did in this session

Concrete, not theoretical. Here is the context strategy that produced these docs.

### Step 1 — Recon before anything else

Before writing a single word, I ran three commands:

```bash
ls -la && find . -type f -not -path "./node_modules/*"   # the map
cat package.json backend/package.json frontend/package.json ...  # the configs
cat -n backend/src/server.js frontend/*.jsx ...                  # the code
```

**Why this order matters.** The tree is cheap (a few hundred tokens) and tells me
what is worth reading. Reading files before you know the shape of the repo means
reading the wrong files.

> **Rule: cheap-and-broad before expensive-and-deep.** Always.

### Step 2 — Read the small things fully, grep the big things

| File | Size | What I did | Why |
|---|---|---|---|
| `backend/src/server.js` | 23 lines | Read fully | Small and load-bearing |
| `frontend/src/pages/login.jsx` | 169 lines | Read fully | The only real UI |
| `docs/01-03*.md` | 2,574 lines | Read **headers only** (`head -60`) | Needed the shape, not the prose |
| `pnpm-lock.yaml` | 130 KB | **Never opened.** Told agents to grep it. | Would have consumed a large share of the window for ~14 useful version strings |

That lockfile decision is the single highest-leverage context call in this session.

### Step 3 — Verify instead of assuming

I did not assume there was no ESLint config. I checked:

```bash
ls -a | grep -i eslint                    # -> nothing
ls -a frontend/ | grep -i eslint          # -> nothing
find . -name "tsconfig*.json"             # -> nothing
ls -a | grep -E "^\.env"                  # -> nothing
```

Four commands, maybe 200 tokens, and they converted four *guesses* into four
*facts* — which is why [`08-gaps-and-findings.md`](../code/08-gaps-and-findings.md)
can state them flatly instead of hedging.

> **Cheap verification beats expensive hedging.** A doc full of "may", "possibly",
> "it appears that" is a doc written by someone who did not run `ls`.

### Step 4 — A real mistake, and what it teaches

I ran `cd docs` early on. The Bash tool's working directory **persists between
calls**. Twenty minutes later I ran `mkdir -p docs/code docs/learn` — which created
`docs/docs/code` and `docs/docs/learn`.

I did not notice. A subagent did, and reported it. I cleaned it up.

The lesson is not "be careful with cd." The lesson is:

> **Environment state is context too** — and it is the kind you forget to track,
> because it is invisible in the transcript.

Hence the rule I now follow: **absolute paths, or an explicit `cd` in every command.**
Never rely on inherited state you cannot see.

---

## 4. Subagents: context isolation as a design tool

This is the part most people never learn, and it is the biggest lever available.

**Every subagent gets a fresh, empty context window.** That is not a limitation —
it is the entire point.

```text
        MAIN SESSION  (context: full repo map, all decisions, the whole plan)
              │
     ┌────────┼────────┬────────┬────────┐
     ▼        ▼        ▼        ▼        ▼
   agent A  agent B  agent C  agent D  agent E
   [empty]  [empty]  [empty]  [empty]  [empty]     ← each starts clean
   backend  frontend  css     deps    config
```

### Why this is powerful

| Property | Consequence |
|---|---|
| Fresh window | Agent D writing the dependency doc never sees the CSS discussion. No dilution. |
| Isolated failure | Agent C going down a rabbit hole costs *its* budget, not mine. |
| True parallelism | Five workers, one wall-clock. |
| Summary-only return | I get a 5-line result, not 60k tokens of its transcript. |

### Why this is dangerous

A fresh window means **the agent knows nothing you did not write down.** All the
recon I did — the empty files, the port wiring, the broken dependabot — is invisible
to them unless I re-state it.

That is why my agent briefs were 40–60 lines each, not 3. Compare:

❌ **Starved brief:**
```text
Comment the frontend files and write a doc about them.
```

✅ **What I actually sent** (abridged):
```text
You own EXACTLY these files: [5 explicit paths]. Do not touch any other file
(another agent owns login.css).

HARD RULES:
- Do NOT change ANY executable logic. Comments only. The UI must render pixel-identical.
- .jsx INSIDE a JSX tree -> {/* */} (a bare // renders as literal text — never do that)

Specific things you MUST explain:
- vite.config.js: envDir '../' matches the backend's dotenv path '../../.env'...
- login.jsx: Illustration is defined INSIDE Login, so it is re-created every render...
- The Google SVG: all four paths are fill="#EA4335". The real mark uses four
  colours. Flag it as a bug in a comment. Do NOT fix it.

VERIFY there is no eslint config before you claim pnpm lint fails.
```

The second one costs ~600 tokens to write and saves an entire wrong-output cycle.

> **Rule: brief a subagent like a contractor who has never seen your building.**
> Because that is exactly what it is.

### The partition rule

The reason five agents could run at once without corrupting each other:

> **Two agents must never hold write access to the same file.**

Shared *reads* are free — three agents read `package.json` concurrently, no problem.
Shared *writes* are the only real hazard. So I partitioned by write-ownership:

| Agent | Writes | Reads |
|---|---|---|
| A | `backend/src/server.js`, `docs/code/03-backend.md` | anything |
| B | 5 frontend source files, `docs/code/04-frontend.md` | anything |
| C | `login.css`, `docs/code/05-styles.md` | anything (incl. `login.jsx`) |
| D | `docs/code/06-dependencies.md` only | anything |
| E | `dependabot.yml`, `docs/code/02,07` | anything |

Agent C needed to read `login.jsx` to collect the SVG colours — allowed, and stated
explicitly: *"you may READ login.jsx but must NOT edit it."*

More on this in [`04-graph-engineering.md`](04-graph-engineering.md).

---

## 5. Techniques, ranked by leverage

### 5.1 Progressive disclosure

Do not front-load everything. Load context in widening rings:

```text
ring 1:  file tree                     ~200 tokens
ring 2:  the 6 config files            ~800 tokens
ring 3:  the 4 real source files     ~3,000 tokens
ring 4:  targeted greps into big files  as needed
ring 5:  the 130KB lockfile            NEVER — grep only
```

Stop as soon as you can act. Most tasks never reach ring 4.

### 5.2 Anchor claims to files

The instruction I gave every agent:

> *"Ground every claim in a file you actually read. If you are unsure, say
> 'not verified' rather than inventing."*

This works because it changes the objective from *sound correct* to *produce
evidence*. Those are different targets and they yield different text.

### 5.3 Persist decisions outside the window

Context dies when the session ends. Anything that should survive goes in a file:

| Where | For what |
|---|---|
| `CLAUDE.md` | Project rules, conventions, commands. Auto-loaded every session. |
| `docs/` | Durable knowledge — exactly what you are reading |
| `.env.example` | The shape of required config |
| Good commit messages | Why, not what |

> A `CLAUDE.md` saying *"this is a pnpm workspace — never use npm; entry files live
> at `frontend/` root, not `frontend/src/`"* saves that explanation in **every future
> session, forever.** Highest-ROI file in any repo you use agents on.

### 5.4 Restate what matters, at the moment it matters

Context is positional. A constraint stated 60 messages ago is weaker than one stated
now. For a critical constraint, repeat it at the point of use. That is not redundancy
— it is signal placement.

### 5.5 Prefer structured over prose

Same facts, very different usefulness:

❌ "The frontend runs on port 3000 and the backend runs on 5000 and there's a proxy."

✅
```text
| Fact          | File                | Value                  |
|---------------|---------------------|------------------------|
| Frontend port | vite.config.js      | 3000                   |
| Backend port  | server.js           | process.env.PORT || 5000 |
| Proxy target  | vite.config.js      | http://localhost:5000  |  ← hardcoded, ignores PORT
```

The table makes the *bug* visible. The prose hides it.

---

## 6. Context budget: a worked accounting

Roughly what this session spent:

| Item | Tokens (approx) | Necessary? |
|---|---|---|
| Repo tree + `ls` | ~400 | ✅ |
| 10 config files, read fully | ~2,500 | ✅ |
| 4 source files, read fully | ~4,000 | ✅ |
| `docs/*.md` headers only | ~1,500 | ✅ (full read would have been ~35,000) |
| 5 agent briefs | ~4,000 | ✅ — bought 5× parallelism |
| Verification commands | ~300 | ✅ — converted 4 guesses to facts |
| `pnpm-lock.yaml` | **0** | ✅ avoided (~40,000 saved) |
| Agent transcripts | **0** | ✅ — summaries only, by design |

**The two big wins were both refusals to read something.** Context engineering is
mostly about what you decline to load.

---

## 7. Anti-patterns

| Anti-pattern | Why it hurts | Do instead |
|---|---|---|
| "Read the whole codebase first" | Dilution. Burns the window on files you never use. | Tree first, then targeted reads |
| `cat` a lockfile / minified bundle / log | Enormous, near-zero information density | `grep` for the specific line |
| One 200-message mega-session | Early instructions get buried; state goes stale | Fresh session per task; persist to `CLAUDE.md` |
| Terse subagent briefs | Fresh window = knows nothing. Guaranteed rework. | Over-brief. It is cheap. |
| Re-explaining the project every message | You are paying for it every turn | Put it in `CLAUDE.md` once |
| Two agents on one file | Lost writes, silent corruption | Partition by write-ownership |
| Trusting inherited shell state | The `cd docs` bug above | Absolute paths, always |
| Pasting a screenshot of an error | Lower fidelity than text | Paste the text |

---

## 8. Checklist

Before a big task:

- [ ] Have I done cheap recon (tree, `ls`) before expensive reads?
- [ ] Is there a huge file I am about to read that I should grep instead?
- [ ] Have I stated the facts the model cannot see (audience, deadline, what I tried)?
- [ ] Should this be a fresh session instead of turn 80 of an old one?
- [ ] Does anything here belong in `CLAUDE.md` permanently?

Before dispatching a subagent:

- [ ] Does the brief name its files **explicitly**?
- [ ] Does it say what it must **not** touch?
- [ ] Does it contain the recon findings it cannot re-derive?
- [ ] Have I said "verify before asserting; write 'not verified' if unsure"?
- [ ] Do any two agents write the same file? *(If yes — fix it now.)*

---

## 9. The relationship between the four disciplines

```text
   PROMPT ENG   ── what you ask for           ── the instruction
   CONTEXT ENG  ── what the model can see     ── the evidence
   LOOP ENG     ── how it self-corrects       ── the feedback
   GRAPH ENG    ── how work is decomposed     ── the structure
```

They compound in a specific order. A perfect prompt over starved context produces
confident nonsense. Perfect context with no loop produces one unverified shot.
A perfect loop with no graph runs everything serially and takes ten times longer.

**Context is the foundation.** Fix it first.

---

**Next:** [`03-loop-engineering.md`](03-loop-engineering.md) — making the work
self-correct instead of hoping it is right first time.
