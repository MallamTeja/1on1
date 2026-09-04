# Your Prompt, Rewritten — before / after, with reasoning

> **The one-sentence version:** your prompt got the intent right and the
> specification wrong. Intent is the hard half, so you are further along than you
> think — but the six things you left unsaid became six decisions I made for you.

---

## 1. The original

```text
hey explan about each file , each codoe line , coment every thing , create md doc
by explian about all of them , each depecncy and all , dont explain in plane chat
in or session do them now , break down thing s, comment the ccode in every file ,
use recon , sub , team etcc agents , spawn as many of htem to amke work as fast
as possible , and teach me that how can i write thiss prompt more goodly like a
senior dev with prompt eng , context eng , loop eng , and teach me graph eng with .md
```

### What is genuinely good in it

Do not skip this part. Four things here are better than the average prompt I receive:

| Good move | Why it matters |
|---|---|
| **"dont explain in plane chat, do them now"** | You specified an *output medium* — files, not chat. Most people forget, get a wall of terminal text, and lose it. This is real output-contract thinking. |
| **"break down things"** | You asked for decomposition instead of one giant blob. That is a structural instruction, and it shaped every doc here. |
| **"spawn as many as possible to make work fast"** | You explicitly authorised parallelism. Without that line I would have worked serially and this would have taken ~4× longer. |
| **"teach me … prompt eng, context eng, loop eng, graph eng"** | You named four *distinct* disciplines. That is not a beginner's list. |

**The typos cost you nothing.** `depecncy`, `codoe`, `thiss`, `htem` — all parsed
fine. Spend zero energy there. The gaps below are what actually cost you.

---

## 2. What was missing, precisely

Six ambiguities. Each one is a decision you delegated to me without meaning to.

| # | Ambiguity | What I decided | Risk if I had guessed differently |
|---|---|---|---|
| 1 | "create md doc" — how many? where? | 13 files in `docs/code/` + `docs/learn/` | One 4,000-line unreadable file |
| 2 | "each file" — including `pnpm-lock.yaml`? the 2,574 lines of existing docs? | Source + config only; grep the lockfile; leave `docs/01-03` alone | Burned context on a lockfile; or overwritten your product docs |
| 3 | Comment the code — **may I change logic?** | Comments only, zero logic changes | An agent "helpfully" fixing the Google SVG mid-comment. Silent logic in a "docs" diff. |
| 4 | Bugs I find — fix or report? | Report + propose, apply nothing | 8 unreviewed behaviour changes |
| 5 | "recon, sub, team agents" | **Those do not exist here.** Mapped to `general-purpose` + peer sessions | Hard failure, or a silent mismatch with what you pictured |
| 6 | "as fast as possible" vs "teach me" | Chose teaching depth over raw speed | A thin, fast, useless set of docs |

**Four of six went your way.** Good odds — and still four coin flips you did not
need to take.

---

## 3. Rewrite A — the 30-second version

For when you want most of the benefit with almost none of the effort. **Three added
sentences**, in the same casual register:

```text
Document and comment this whole codebase. Write the docs as markdown files under
docs/, broken into one file per area — don't explain in chat.

Comment every source file: comments ONLY, do not change a single line of logic.
If you find bugs, write them up in a findings doc and propose the fix — don't apply it.
Skip pnpm-lock.yaml (grep it if you need versions) and don't touch docs/01-03, they're my
product spec.

Fan it out to parallel agents, one per area, each owning a disjoint set of files.
If an agent type I name doesn't exist, use the equivalent and tell me.

Then also write me teaching docs on prompt engineering, context engineering, loop
engineering, and graph engineering — use this session as the worked example.
```

**Same length as yours. All six ambiguities closed.** This is the version to
actually internalise, because you will realistically write this one.

The four sentences doing the heavy lifting:
1. `comments ONLY, do not change a single line of logic` — closes #3
2. `don't apply it` — closes #4
3. `Skip pnpm-lock.yaml … don't touch docs/01-03` — closes #2
4. `If an agent type I name doesn't exist, use the equivalent and tell me` — closes #5

---

## 4. Rewrite B — the full specification

For work you actually care about. Follows the six-slot template from
[`01-prompt-engineering.md`](01-prompt-engineering.md).

```markdown
## Task
Document and comment the entire 1on1 codebase, then teach me the agent-driving
disciplines you used to do it.

## Context
- Solo project, I'm the only maintainer. I'm mid-learning — docs should TEACH,
  not just describe.
- docs/01-03*.md are my product spec, written before the code. Most of it isn't
  built yet. I want that gap written down honestly, not papered over.
- The .pdf files in docs/ are exports of the .md — ignore them.
- Nothing is installed yet (no node_modules, no .env). Don't try to run the app.

## Scope
IN:
  - backend/src/server.js
  - frontend/{index.html,main.jsx,app.jsx,vite.config.js}
  - frontend/src/pages/{login.jsx,login.css}
  - all package.json files, pnpm-workspace.yaml, .npmrc, .gitignore
  - .github/dependabot.yml, .github/workflows/codeql.yml
OUT:
  - pnpm-lock.yaml (grep for versions; never read it whole)
  - docs/01-03*.md (READ for grounding, never edit)
  - node_modules, *.pdf

## Constraints
- Comments ONLY in source files. Do not change one executable line.
  Verify: comment-stripped diff vs `git show HEAD:<file>` must be byte-identical.
- Do NOT fix bugs. Document them, show the fix in a fenced block, apply nothing.
- Every factual claim cites a real file path. Cannot verify it? Write "not verified".
- Don't create files outside docs/.
- If a tool or agent type I name doesn't exist here, say so and use the equivalent.

## Output
docs/code/
  00-index.md            map of all docs
  01-repo-anatomy.md     file tree, what each file is, how the halves connect
  02-root-config.md      root package.json, workspaces, .npmrc, .gitignore, README
  03-backend.md          server.js walkthrough + request lifecycle
  04-frontend.md         render chain, login.jsx, vite config, SVG primer
  05-styles.md           login.css rule by rule + design tokens
  06-dependencies.md     every dep: what, why, where used, gotcha
  07-ci-and-security.md  codeql, dependabot, security posture
  08-gaps-and-findings.md bugs, gaps, doc-vs-code mismatches, severity-ranked
docs/learn/
  00-index.md, 01-prompt-engineering.md, 02-context-engineering.md,
  03-loop-engineering.md, 04-graph-engineering.md, 05-your-prompt-rewritten.md

Each doc: H1 title, one-line blockquote summary, tables over prose,
fenced code blocks, relative links between siblings.

## Execution
Fan out to parallel agents partitioned by WRITE OWNERSHIP — no two agents may
write the same file. Shared reads are fine. Brief each one with the recon findings
it can't re-derive on its own.

## Done when
- [ ] every in-scope source file has a header comment + inline comments
- [ ] `node --check backend/src/server.js` exits 0
- [ ] comment-stripped diff vs HEAD is byte-identical for every edited source file
- [ ] all 15 doc files exist and both 00-index.md files link to every sibling
- [ ] no file outside docs/ was created
- [ ] findings doc is severity-ranked with file:line references

## Optimise for
Teaching depth first, speed second. I'd rather wait and actually learn it.
```

**Why this version is worth the effort on real work:** the "Done when" block is
mostly machine-checkable. That converts "produce plausible documentation" into
"pass six tests" — and those produce measurably different output.

---

## 5. Side-by-side diff of the key lines

| Yours | Rewritten | What changed |
|---|---|---|
| "explan about each file" | "IN: [11 explicit paths] / OUT: pnpm-lock.yaml, docs/01-03, node_modules" | Unbounded → bounded |
| "coment every thing" | "Comments ONLY. Do not change one executable line. Verify with a comment-stripped diff." | Added the wall + the proof |
| "create md doc" | A 15-file tree with exact names and a per-file format spec | Undefined → contract |
| "use recon , sub , team etcc agents" | "Partition by write ownership. If a type I name doesn't exist, use the equivalent and tell me." | Named a tool → described the shape |
| "as fast as possible" | "Optimise for teaching depth first, speed second." | Ambiguous → ranked |
| *(absent)* | The entire "Done when" block | Nothing → six checkable criteria |
| *(absent)* | "Do NOT fix bugs — document and propose" | The most dangerous gap, closed |

---

## 6. The three sentences with the highest return

If you remember nothing else from these docs, remember these. Each one takes
seconds to type and prevents an entire class of failure.

### 1. The scope wall
```text
IN: <explicit list>.  OUT: <explicit list>.
```
`OUT` matters more than `IN`. It is the half nobody writes.

### 2. The evidence rule
```text
Every factual claim must cite a real file path. If you can't verify it from a file
you actually read, write "not verified" — don't infer.
```
The single best anti-hallucination sentence in existence. Use it in every research
prompt, forever.

### 3. The blast radius
```text
Do X only. Do not change anything else. If you think something else needs changing,
tell me — don't do it.
```
This is the sentence that separates "an agent helped me" from "an agent touched
40 files and I don't know which changes were intentional."

---

## 7. What actually happened, so you can calibrate

The real execution of your prompt:

| Phase | Wall clock | Shape |
|---|---|---|
| Recon | ~1 min | Serial, unavoidable — 3 batched commands, whole repo mapped |
| Fan-out | ~10 min | 5 subagents + 2 peer sessions + me, all concurrent, disjoint files |
| Fan-in | ~2 min | Index files linking everything (must be last) |

**Serial would have been roughly 45–60 minutes.** Your "spawn as many as possible"
line is what bought that. It was the most valuable sentence in your prompt — which
is worth noticing, because it was also the vaguest one. You got lucky that the
*intent* was legible even though the *instruction* was not executable as written.

The graph structure behind that is in [`04-graph-engineering.md`](04-graph-engineering.md).

---

## 8. Practise this

Next three non-trivial prompts you write, do exactly this:

1. Write the **"Done when"** block *first*, before anything else. If you cannot
   write it, stop — you do not yet know what you want, and no prompt polish fixes that.
2. Add **one `OUT:` line**. Just one thing you do not want touched.
3. After you get the response, ask: *"where did this differ from what I pictured?"*
   Find the sentence that would have prevented it. Add it to your template.

Step 3 is the whole discipline. Everything else is just this document.

---

**Back to:** [`00-index.md`](00-index.md) · [`01-prompt-engineering.md`](01-prompt-engineering.md)
