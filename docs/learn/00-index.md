# Driving AI Coding Agents — the four disciplines

> Four skills that compound. Each one is taught with **this repo and this session**
> as the worked example — the real prompts, the real parallel execution, the real
> mistake that happened halfway through.

---

## Why these four, and in this order

```text
   PROMPT ENG   ── what you ask for        ── the INSTRUCTION
   CONTEXT ENG  ── what the model can see  ── the EVIDENCE
   LOOP ENG     ── how it self-corrects    ── the FEEDBACK
   GRAPH ENG    ── how work is decomposed  ── the STRUCTURE
```

They stack, and the order matters:

- A **perfect prompt** over starved context produces confident nonsense.
- **Perfect context** with no loop produces one unverified shot that looks right.
- A **perfect loop** with no graph runs everything serially and takes 10× longer.
- A **perfect graph** with a vague prompt parallelises the wrong work efficiently.

Most people learn only the first one and plateau there. The second is the bigger
lever. The third is what separates "it usually works" from "it is reliable." The
fourth is what makes it fast.

---

## The documents

| # | Document | Core question it answers |
|---|---|---|
| 01 | [Prompt Engineering](01-prompt-engineering.md) | *How do I ask so I get the thing I actually wanted?* |
| 02 | [Context Engineering](02-context-engineering.md) | *What can the model see, and what am I wasting its attention on?* |
| 03 | [Loop Engineering](03-loop-engineering.md) | *How does the work verify itself instead of me hoping it is right?* |
| 04 | [Graph Engineering](04-graph-engineering.md) | *How do I decompose work so it can run in parallel without corrupting itself?* |
| 05 | [Your Prompt, Rewritten](05-your-prompt-rewritten.md) | *Concretely — what should I have typed?* |

---

## The single idea from each

If you only take one sentence from each document:

### 01 — Prompt engineering
> **Every ambiguity in your prompt is a decision you delegated by accident.**

Your original prompt left six ambiguities. I made six decisions for you. Four went
your way. That is a good hit rate and still four coin flips you did not need to take.

### 02 — Context engineering
> **Context engineering is mostly about what you decline to load.**

The two highest-value moves in this session were both refusals: never opening the
130KB `pnpm-lock.yaml`, and reading only the *headers* of the 2,574 lines of
existing product docs. Together that saved roughly 70,000 tokens of dilution.

### 03 — Loop engineering
> **Never let a loop mark its own homework with prose. Bind it to a command that
> exits nonzero.**

This session's gate: strip all comments from both the committed file and the current
file, then diff. That turned "I think the agents only added comments" into proof:

```text
OK  frontend/src/pages/login.jsx  --  134 executable lines, byte-identical
```

### 04 — Graph engineering
> **Partition by write ownership. Shared reads are free; shared writes are the only
> real edge.**

Five subagents and two peer sessions ran concurrently on this repo without a single
conflict, because no two of them could write the same file. Three of them read
`login.jsx` at the same time — harmless. Only one could edit it.

### 05 — The rewrite
> **Three sentences would have closed all six gaps in your original prompt.**

---

## How this session actually ran

The documentation job you asked for was executed as a dependency graph:

```text
  LEVEL 0 — RECON (serial, blocking, unavoidable)
     main session reads the whole repo: tree, 10 configs, 4 source files
     │
     ▼
  LEVEL 1 — FAN-OUT (8 workers, concurrent, disjoint write-sets)
     ├── agent A ── backend/src/server.js        + docs/code/03
     ├── agent B ── 5 frontend source files      + docs/code/04
     ├── agent C ── login.css                    + docs/code/05
     ├── agent D ── (read-only)                  + docs/code/06
     ├── agent E ── .github/dependabot.yml       + docs/code/02, 07
     ├── peer 1on1-43 ──────────────────────────── docs/learn/03
     ├── peer 1on1-52 ──────────────────────────── docs/learn/04
     └── main ──────────────────────────────────── docs/code/01, 08
                                                   docs/learn/01, 02, 05
     │
     ▼
  LEVEL 2 — FAN-IN (serial join, must be last)
     main writes docs/code/00-index.md + docs/learn/00-index.md
     (they link to everything, so they cannot run before everything exists)
```

**Recon could not be parallelised** — you cannot partition work you have not
surveyed. **The index could not be parallelised** — it depends on every other node.
Everything between them ran 8-wide. That shape (narrow → wide → narrow) is the most
common one in real work, and recognising it is most of graph engineering.

### The mistake, kept in on purpose

Early on I ran `cd docs`. The shell's working directory **persists between calls**.
Twenty minutes later `mkdir -p docs/code docs/learn` created `docs/docs/code` and
`docs/docs/learn`. I did not notice — a subagent did, and reported it in its summary.

It is written up in [`02-context-engineering.md §3.4`](02-context-engineering.md) and
[`04-graph-engineering.md`](04-graph-engineering.md) because it teaches something
neither document would otherwise show:

> **The filesystem and the working directory are shared mutable state — an edge in
> your graph that you forgot to draw.**

The fix is the same one `backend/src/server.js` already uses: derive absolute paths
explicitly, never trust inherited state.

---

## The practical checklist

Pin this. It is the whole thing in twelve lines.

**Before you type:**
- [ ] Can I write "done when ___"? If not, I do not know what I want yet.
- [ ] What is the **OUT:** list — what must not be touched?
- [ ] What am I optimising for: speed, correctness, teaching, or minimal diff?

**Before it runs:**
- [ ] Cheap recon (tree, `ls`) before expensive reads?
- [ ] Any huge file I should `grep` instead of `cat`?
- [ ] Facts stated that the model cannot see from the files?

**While it runs:**
- [ ] Is there a command that proves this worked, not prose that claims it?
- [ ] What is the stop condition — and the *give up* condition?

**If parallelising:**
- [ ] Do any two workers write the same file? *(Fix that first.)*
- [ ] Does each brief carry the recon it cannot re-derive?
- [ ] What is the join node, and does it genuinely have to run last?

---

## Related

- [`../code/00-index.md`](../code/00-index.md) — the documentation these techniques
  produced: every file and dependency in this repo explained.
- [`../code/08-gaps-and-findings.md`](../code/08-gaps-and-findings.md) — a worked
  example of the "name the failure mode you fear" technique from
  [`01-prompt-engineering.md §4.4`](01-prompt-engineering.md). That whole document
  exists because one sentence in a brief asked for the code-vs-docs gap to be stated
  honestly rather than smoothed over.
