# Prompt Engineering — how to ask so you get the thing you wanted

> **The one-sentence version:** a prompt is a *specification*, and every ambiguity
> you leave in it is a decision you have silently delegated to the model.

This document uses **your own prompt from this session** as the worked example.
Not a toy example — the real one, scored honestly, then rewritten.

---

## 1. Your prompt, exactly as sent

```text
hey explan about each file , each codoe line , coment every thing , create md doc
by explian about all of them , each depecncy and all , dont explain in plane chat
in or session do them now , break down thing s, comment the ccode in every file ,
use recon , sub , team etcc agents , spawn as many of htem to amke work as fast
as possible , and teach me that how can i write thiss prompt more goodly like a
senior dev with prompt eng , context eng , loop eng , and teach me graph eng with .md
```

### Honest scorecard

| Dimension | Score | Why |
|---|---|---|
| **Intent clarity** | 8/10 | I understood what you wanted. This is the part that matters most, and you got it right. |
| **Scope boundaries** | 3/10 | "each file" — including `pnpm-lock.yaml`'s 130,000 lines? Including the 2,574 lines of existing docs? Undefined. |
| **Output contract** | 2/10 | "create md doc" — one file or twelve? Where? What filenames? I had to invent `docs/code/` and `docs/learn/`. |
| **Definition of done** | 1/10 | Nothing tells me when to stop or how to verify I succeeded. |
| **Constraints / guardrails** | 2/10 | "comment the code in every file" — may I change logic while I'm in there? You almost certainly meant no. You did not say no. |
| **Executability** | 5/10 | "use recon, sub, team agents" — **none of those agent types exist** in this environment. I had to silently translate to what does exist. |
| **Typos** | — | Genuinely irrelevant. `depecncy`, `codoe`, `thiss` all parsed fine. **Stop worrying about typos.** Worry about the six rows above. |

**Overall: it worked, but it worked because I filled six gaps with guesses.**
Six guesses is six chances to build the wrong thing.

---

## 2. The single most important idea

> Every ambiguity in your prompt is a **decision you delegated by accident**.

You did not decide these things. I did:

| Ambiguity in your prompt | The decision I made for you |
|---|---|
| "create md doc" | 13 files across two directories |
| Where do they go? | `docs/code/` and `docs/learn/` |
| Comment every file — logic changes allowed? | No. Comments only. |
| Include `pnpm-lock.yaml`? | No — grep it for versions, never dump it |
| Include the existing `docs/*.md`? | Read them for grounding, do not rewrite them |
| Fix the bugs I find? | No — document them, propose fixes, apply nothing |

Four of those six went your way. That is a **good** hit rate, and it is still four
coin flips you did not need to take. The fix is not "write longer prompts." The fix
is to notice which decisions are *yours* and state only those.

---

## 3. The anatomy of a senior-level prompt

Six slots. Not all six every time — but know which one you are skipping and why.

```text
┌─────────────────────────────────────────────────────────────┐
│ 1. ROLE / STANCE     who is doing this, at what altitude    │
│ 2. TASK              the verb. one clear objective.         │
│ 3. CONTEXT           what is true that I cannot see         │
│ 4. CONSTRAINTS       the walls. especially the NOTs.        │
│ 5. OUTPUT CONTRACT   exact shape, location, format          │
│ 6. DONE CRITERIA     how we both know it worked             │
└─────────────────────────────────────────────────────────────┘
```

### Slot 1 — Role / stance

Sets altitude, not personality. Compare:

- ❌ "You are a helpful expert assistant" — pure noise, changes nothing
- ✅ "Act as the engineer who will maintain this in 6 months and has never seen it"

The second one is *load-bearing*: it tells me to explain the obvious, prefer clarity
over cleverness, and write down the things that were only in your head.

### Slot 2 — Task

One verb. If you have three verbs, you have three prompts.

Your prompt had **four** tasks fused together:
1. comment the source files
2. write reference docs about the code
3. write teaching docs about prompt/context/loop/graph engineering
4. rewrite my prompt

That fusion is *why* the scope was ambiguous. Four tasks in one sentence means the
constraints of each bleed into the others.

> **Rule:** if you cannot say "done when ___" for the whole prompt in one clause,
> it is more than one task.

### Slot 3 — Context

Everything true that is not visible from the files. This is the highest-value slot
and the one people skip most.

What you knew and did not tell me:

```text
- 1on1 is a solo project; you are the only maintainer
- the docs/ folder is the *plan*, the code is 5 commits in — the gap is expected
- you are learning, so the docs should teach, not just describe
- the PDFs in docs/ are exports of the .md, not separate sources
```

Every one of those changes what I write. I inferred the last three from evidence.
The first I still do not actually know.

### Slot 4 — Constraints (the NOTs)

**This is where amateurs and seniors diverge most visibly.**

Juniors describe what they want. Seniors describe the walls, because a model will
cheerfully do a *reasonable* thing you did not want.

Constraints your prompt needed but did not have:

```text
- comments ONLY — do not change one line of executable logic
- do not fix bugs; document them and propose the fix in the doc
- do not rewrite docs/01-03; they are the source of truth, read-only
- never dump pnpm-lock.yaml into context — grep it
- do not create files outside docs/
- if a claim cannot be verified from a file, write "not verified" instead of guessing
```

That last one is the highest-leverage sentence in this entire document. Write it in
every research prompt you ever send.

### Slot 5 — Output contract

Where, what shape, what filenames. Ambiguity here is the most expensive kind because
you only discover it *after* the work is done.

- ❌ "create md doc"
- ✅ "create `docs/code/NN-topic.md`, numbered `01`–`08`, each with an H1 title, a
  purpose paragraph, and a table of contents. Also create `docs/code/00-index.md`
  linking all of them."

### Slot 6 — Done criteria

The slot almost nobody writes, and the one that most improves output quality —
because it turns "produce text" into "pass a test."

```text
Done when:
  - every source file under backend/src and frontend/ has a header comment
  - `node --check backend/src/server.js` passes
  - comment-stripped diff vs HEAD is byte-identical (proves zero logic changed)
  - docs/code/00-index.md links to every file in docs/code/
  - every factual claim cites a real file path
```

Notice what happened: **three of those are machine-checkable.** A model given a
checkable criterion will check it. Given none, it will produce something plausible
and stop.

---

## 4. Techniques that actually move the needle

Ranked by return on effort.

### 4.1 Negative space beats positive space

One good constraint outperforms three good descriptions:

> "Comment every file. **Do not change any executable line.** If a comment would
> require restructuring code to make sense, leave a `TODO:` and explain why in the doc."

That single bolded sentence prevented an entire category of disaster in this session:
an agent "helpfully" fixing the Google SVG colours while adding comments, and you
never noticing the diff had logic in it.

### 4.2 Ground every claim in a file

> "Every factual claim must cite a real file path and line number. If you cannot
> verify something from a file you actually read, write `not verified` — do not infer."

This is *the* anti-hallucination move. It converts "sound authoritative" into
"produce evidence," and those are very different objectives.

### 4.3 Give examples of the shape, not the content

Two lines of example beat two paragraphs of description:

```text
Format each dependency like this:

### express — ^4.18.2 — runtime
**What:** minimal HTTP framework built on a middleware pipeline.
**Used in:** backend/src/server.js:11
**Gotcha:** Express 5 is out and is a breaking change; this repo pins the 4.x line.
```

Now every one of the fourteen dependency entries comes back consistent. Without it
you get fourteen slightly different shapes.

### 4.4 Name the failure mode you fear

> "The failure I am worried about: docs that describe what the code *should* do
> instead of what it *does*. Where the code and `docs/03-system-design.md` disagree,
> say so explicitly."

Naming the fear steers directly at it. This one sentence is why
[`08-gaps-and-findings.md`](../code/08-gaps-and-findings.md) exists as its own file.

### 4.5 Say what you are optimising for

Same task, three different right answers:

| You say | You get |
|---|---|
| "optimise for speed, rough is fine" | fast pass, some gaps |
| "optimise for correctness, take your time" | verification steps, slower |
| "optimise for teaching a beginner" | more prose, more analogies, fewer assumptions |

You wanted the third. You said "as fast as possible," which points at the first.
I chose the third from surrounding evidence. **I could easily have chosen wrong.**

### 4.6 Front-load the verb

Models — and humans — weight the opening heavily. Compare:

- ❌ "hey so I was thinking maybe about the files and stuff, could you like…"
- ✅ "**Document and comment this codebase.** Details follow."

Then elaborate. State the objective in sentence one, always.

---

## 5. Anti-patterns

| Anti-pattern | Example | Cost |
|---|---|---|
| **Fused tasks** | Your 4-in-1 prompt | Constraints bleed across tasks |
| **Politeness padding** | "if you could maybe possibly…" | Dilutes the signal; adds nothing |
| **Unbounded quantifiers** | "each file", "everything", "all" | I must guess where the boundary is |
| **Invented capability names** | "use recon, sub, team agents" | Those do not exist. I had to translate silently. |
| **No done criteria** | (most prompts) | Output is "plausible" instead of "verified" |
| **Asking for a plan when you want the work** | "how would you approach…" | You get a plan. You wanted files. |
| **Asking for the work when you want a plan** | "just do it" on a risky change | Now you are reviewing 40 files instead of 1 paragraph |

### On that "recon, sub, team agents" line

Worth dwelling on, because it is instructive.

You asked for agent types that do not exist here. I did not error out — I mapped your
*intent* ("fan out parallel workers") onto what actually exists (`general-purpose`,
`Explore`, `Plan`). That worked. But it worked because your intent was legible; if
you had named a specific capability with specific semantics, the silent translation
could have produced something quite different from what you pictured.

**The senior move:** describe the *shape of the work*, not the name of the tool.

- ❌ "use recon, sub, team agents"
- ✅ "fan this out to parallel workers, one per area, each owning a disjoint set of
  files so they cannot conflict. Use whatever concurrency primitive this environment
  actually has — if the thing I named does not exist, tell me and use the equivalent."

That last clause is free insurance. Add it whenever you name a tool you are not
certain about.

---

## 6. The template

Copy this. Delete slots you genuinely do not need.

```markdown
## Task
<one sentence, verb first>

## Context
- <fact not visible in the files>
- <constraint from the real world: deadline, audience, who maintains this>
- <what I already tried, if anything>

## Scope
IN:  <explicit list>
OUT: <explicit list — this half matters more>

## Constraints
- <the NOTs>
- If a claim cannot be verified from a file you read, write "not verified".
- If a tool/capability I named does not exist here, tell me and use the equivalent.

## Output
- <exact files / format / location>
- <a shape example if consistency across many items matters>

## Done when
- [ ] <machine-checkable criterion>
- [ ] <machine-checkable criterion>
- [ ] <human-judgement criterion>

## Optimise for
<speed | correctness | teaching | minimal diff> — pick ONE primary.
```

---

## 7. Your prompt, rewritten

Full side-by-side with commentary in
[`05-your-prompt-rewritten.md`](05-your-prompt-rewritten.md).

---

## 8. What to practise

Three habits, in order of payoff:

1. **Write the "Done when" first.** Before anything else. If you cannot write it,
   you do not yet know what you want — and no amount of prompt polish fixes that.
2. **Write one NOT for every three wants.** Sounds arbitrary. It calibrates you to
   think about walls, which is the actual skill.
3. **After a response, diff intent vs output.** Where they differ, find the sentence
   that should have prevented it. Add that sentence to your personal template.
   That third habit is the whole discipline, compounding.

---

**Next:** [`02-context-engineering.md`](02-context-engineering.md) — the prompt is
what you say; context is what I can *see*. Different problem, bigger lever.
