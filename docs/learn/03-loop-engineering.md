# Loop Engineering — how to run an agent so it converges instead of wandering

> **The one-sentence version:** a loop is only as good as the signal that tells it
> whether the last step worked. Fix the signal and an average model converges; leave
> the signal to prose and the best model in the world drifts — confidently.

[`01-prompt-engineering.md`](01-prompt-engineering.md) is what you *say*.
[`02-context-engineering.md`](02-context-engineering.md) is what I can *see*.
This one is what happens **after the first answer** — which is where almost all real
engineering work actually lives.

---

## 1. What a loop actually is

One-shot prompting is: you ask, I answer, you read it. The model never finds out
whether it was right.

A loop is: I act, **something outside me judges the result**, and that judgement comes
back as input to the next step.

```
        ┌───────────────────────────────────────────────────┐
        │                     repeat                        │
        v                                                   │
  ┌──────────┐  ┌────────┐  ┌───────┐  ┌────────────┐  ┌────┴─────┐
  │ PERCEIVE │─>│  PLAN  │─>│  ACT  │─>│  OBSERVE   │─>│ CORRECT  │
  │ read     │  │ pick   │  │ edit  │  │ RUN THE    │  │ change   │
  │ state    │  │ ONE    │  │ file  │  │ GATE (cmd) │  │ ONE      │
  │          │  │ step   │  │       │  │ exit code! │  │ thing    │
  └──────────┘  └────────┘  └───────┘  └─────┬──────┘  └──────────┘
                                             │
                                  exit 0 AND goal reached?
                                             │ yes
                                             v
                                         ┌──────┐
                                         │ STOP │
                                         └──────┘
```

| | One-shot prompt | Loop |
|---|---|---|
| You supply | a message | a goal **+ a gate** |
| Model sees the result of its own work | no | yes |
| Who catches the mistake | you, by reading | the gate, by exit code |
| Typical failure | wrong output, stated confidently | spinning, or stopping too early |
| Right tool for | questions, drafts, tiny edits | anything that must actually *run* |

> **The central claim of this document:** broken agent loops are almost never broken
> at ACT. The model can edit files fine. They are broken at **OBSERVE** — the step
> where "did that work?" got answered by an opinion instead of by a process exit code.

An LLM asked "did your change work?" will answer from the text it just wrote, because
that text is the freshest, loudest thing in its context. It is the worst possible
witness. Replace it with a command.

---

## 2. Exit conditions — decide these *before* iteration 1

The #1 loop failure is having no defined stop. It ends one of two ways: the agent
declares victory on something that does not run ("looks done"), or it grinds through
your budget re-trying variations of the same broken idea.

You need **four** stop rules, not one.

| Rule | Question it answers | Concrete form |
|---|---|---|
| **Success** | when am I finished? | `pnpm build` exits 0 **and** `curl -fsS localhost:5000/api/health` exits 0 |
| **Failure** | when do I abandon this approach? | the same error appears twice in a row |
| **Budget** | when do I stop no matter what? | 6 iterations, or 20 minutes |
| **No-progress** | am I actually moving? | error signature unchanged since last iteration |

### The no-progress detector

"Same error twice = stop and rethink" is the single highest-value rule in this doc.
Retrying an unchanged failure is not persistence, it is a hang with extra steps.

You can literally compute it:

```bash
# Reduce the failure to a short, comparable fingerprint.
sig() { "$@" 2>&1 | tail -n 5 | shasum | cut -c1-8; }

before=$(sig pnpm build)
#  ... agent makes a change ...
after=$(sig pnpm build)

if [ "$before" = "$after" ]; then
  echo "NO PROGRESS — same failure. Stop looping. Change the hypothesis."
fi
```

If the fingerprint is unchanged, the last edit was *irrelevant to the failure*. That
is information. It means your model of the bug is wrong, and the correct next move is
to go read something, not to edit something.

### Say the stop rules out loud in the prompt

```text
Loop until `node --check backend/src/server.js && pnpm build` exits 0.
Max 6 iterations.
If the same error appears twice in a row, STOP and report the error plus your
current hypothesis — do not try a third variation.
Never edit a file outside backend/src/ to make the gate pass.
```

That last line matters more than it looks. Without it, a loop under pressure will
"fix" the build by deleting the failing import. It satisfied the gate. It did not
solve your problem. See §5.

---

## 3. The verification gate

> **Never let a loop mark its own homework with prose.**

A gate is a command that exits **0 for pass, nonzero for fail**. Nothing else counts.

| Prose gate (fake) | Command gate (real) |
|---|---|
| "The code now looks correct." | `node --check backend/src/server.js` |
| "I've verified the imports are fine." | `pnpm build` |
| "The endpoint should work now." | `curl -fsS localhost:5000/api/health` |
| "I only added comments." | strip comments, `diff` against `git show HEAD:<file>` |

### The gate ladder for *this* repo

Cheap gates first. Run the expensive one only when the cheap ones are green.

| # | Gate | Proves | Cost | Prerequisite | Status today |
|---|---|---|---|---|---|
| 1 | `git diff --name-only` | you touched only what you meant to | instant | none | works |
| 2 | `node --check backend/src/server.js` | the file parses as valid JS | instant | node only | works |
| 3 | `pnpm install` | dependency tree resolves | slow, once | network | not run yet |
| 4 | `pnpm --filter 1on1-frontend run build` | React app compiles, imports resolve | seconds | gate 3 | blocked on 3 |
| 5 | `pnpm --filter 1on1-frontend run lint` | style + unused vars | seconds | gate 3 **+ an eslint config** | **fails today** |
| 6 | `curl -fsS localhost:5000/api/health` | the server boots and routes | seconds | server running | works |

Two honest observations about that table:

**Gate 5 is broken.** `frontend/package.json` defines a `lint` script, but there is no
eslint config file in the repo, so the command errors out for reasons that have nothing
to do with your code. **A broken gate is worse than no gate** — it produces noise that
teaches the loop (and you) to ignore red. Before you loop on lint, spend one iteration
making lint pass on *untouched* code. A gate is only meaningful if it was green before
you started. See [`../code/08-gaps-and-findings.md`](../code/08-gaps-and-findings.md).

**Gate 6 needs the `-f`.** This is the classic beginner gate bug:

```bash
curl -s  localhost:5000/api/health   # exit 0 even on 404 or 500. USELESS AS A GATE.
curl -fsS localhost:5000/api/health  # exit 22 on any HTTP error. Correct.
```

`curl -s` succeeds as long as the TCP connection worked. A loop gated on it will
happily "pass" against a 404 page forever. Always `-f` in a gate.

### The comment-only proof

This session's task was "comment every file, change no logic". That is exactly the kind
of promise that is easy to say and hard to trust. So don't trust it — prove it:

```bash
# Delete every comment and blank line, deterministically.
strip() {
  perl -0777 -pe 's{/\*.*?\*/}{}gs; s{//.*$}{}gm; s{^\s*\n}{}gm' "$1"
}

f=backend/src/server.js
git show "HEAD:$f" > /tmp/before.js

if diff <(strip /tmp/before.js) <(strip "$f") > /dev/null; then
  echo "PROVEN: comments only, code identical"
else
  echo "LOGIC CHANGED — review the diff:"
  diff <(strip /tmp/before.js) <(strip "$f")
fi
```

Note the subtle point that makes this work: **that stripper is not a correct JS
parser.** It will mangle a `//` inside a string like `"http://localhost"`. It does not
matter — it mangles it *identically on both sides*, so the diff is still valid. A gate
does not need to be correct in general. It needs to be **deterministic and applied to
both sides of the comparison.** That relaxation is what lets you build cheap gates for
things that look unverifiable.

---

## 4. Four kinds of loop

They are not interchangeable. Picking the wrong one is why work feels slow.

| | **Inner / tight** | **Outer** | **Supervisory** | **Scheduled / polling** |
|---|---|---|---|---|
| Shape | edit → test → fix | build → review → refine | agent works, human approves | wake → check → act or sleep |
| Duration | seconds | minutes to hours | hours to days | indefinite |
| Signal source | compiler, test runner, type checker | code review, a spec, integration tests | a person's judgement | external state (CI, a queue, a deploy) |
| Cost per iteration | ~free | moderate | expensive (human time) | cheap but never-ending |
| Who stops it | the gate command | the reviewer, or a checklist | the human | a condition, or a max-runs limit |
| Failure mode | thrashing on a bad hypothesis | scope creep; drifting from the spec | human becomes the bottleneck and rubber-stamps | polls forever, burns budget on "no change" |
| Use it for | one file, one error, known cause | one feature end-to-end | anything irreversible: schema, deploy, auth | waiting on someone else's system |

Rules of thumb:

- **Stay in the inner loop as long as the gate is fast.** Speed of feedback beats
  cleverness. A 2-second gate you run 30 times finds more bugs than a 5-minute gate you
  run twice.
- **Promote to the outer loop when the gate stops being informative** — the build is
  green but the feature is still wrong. That is not a compiler problem, it is a spec
  problem. Go back to the spec, not to the code.
- **Force a supervisory checkpoint for anything you cannot `git checkout` away**:
  `pnpm install` changing the lockfile, secrets, database migrations, anything pushed.
- **In a polling loop, match the interval to how fast the world changes.** A CI run
  that takes 8 minutes deserves one check at ~8 minutes, not sixteen checks at 30s.

---

## 5. Guardrails — the loop will exploit anything you leave open

An agent optimises for the gate you gave it, not the goal in your head. That is not
malice, it is exactly what you asked for. So bound it.

| Guardrail | Why | How you say it |
|---|---|---|
| **Read-only recon first** | a plan built on guesses fails on iteration 1 and you pay for it 5 more times | "Do not edit anything until you have read `server.js`, `app.jsx` and `login.jsx` and stated your plan." |
| **Blast radius** | stops the loop from "fixing" the gate by editing unrelated files | "Only `frontend/src/pages/login.jsx` and `backend/src/server.js` may change." |
| **Git as undo buffer** | the real safety net — free, instant, total | `git switch -c feat/login-wiring` before iteration 1; `git commit` at every green gate |
| **Propose diff before applying** | for risky edits, moves the decision to you at near-zero cost | "Show me the diff for `server.js` and wait. Do not write it yet." |
| **External check on "done"** | see below | the gate command belongs to *you*, not to the loop |

### Why a loop that can both write and self-certify is unsound

If the same agent decides *what changed* and *whether it is finished*, there is no
independent observer anywhere in the system. Every self-consistent story passes.

The fix is not a smarter model. The fix is structural: **the judgement must come from a
process the agent does not control.** `node`, `vite`, `curl`, `diff`, a test runner, or
you. Any of those. Just not the writer.

This is the same reason you don't merge your own PR without review, and the same reason
`git commit` at every green gate matters: those checkpoints are the only points you can
return to that you have *evidence* about.

```bash
git switch -c feat/login-wiring       # iteration 0 — before anything
# ... loop ...
git add -A && git commit -m "wip: controlled inputs, build green"   # every green gate
git diff HEAD~1                        # what did the last iteration actually do?
git reset --hard HEAD~1                # cheapest possible rollback
```

Commit messages during a loop are for **you**, in 20 minutes, picking a checkpoint to
fall back to. `wip` is fine; `build green` is the half that earns its keep.

---

## 6. TDD is loop engineering (that's why it works)

Red / green / refactor is not a testing ritual. It is the loop pattern with a
machine-checkable gate, discovered long before anyone was pointing an LLM at a repo.

```
  write a FAILING test  ──>  RED     (gate proves the test CAN fail — nonzero)
          │
          v
  minimum code to pass  ──>  GREEN   (gate proves the code works — exit 0)
          │
          v
  clean it up           ──>  GREEN   (gate proves you broke nothing — still exit 0)
```

The step everyone skips is RED, and it is the one that carries the information. A test
you have never seen fail is not a gate — it might be passing because it asserts
nothing. Watching it fail first is how you verify **the gate itself**.

Applied to this repo's actual next task — wiring `login.jsx` to the backend:

```js
// 1. RED — this must fail first, because POST /api/auth/login does not exist yet.
//    Run it. See the failure. That failure is your proof the gate has teeth.
const res = await fetch('/api/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'a@b.com', password: 'x' }),
});
console.assert(res.status === 200, 'expected 200, got ' + res.status);
```

Then: add the route, watch it go green, then refactor. One assertion per iteration.

You have no test runner installed yet, and that is fine — `curl` plus an exit code is a
legitimate gate. The discipline is what matters, not the framework:

```bash
curl -fsS -X POST localhost:5000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"a@b.com","password":"x"}'
echo "exit=$?"     # nonzero BEFORE you write the route, 0 after. That is red/green.
```

---

## 7. Anti-patterns

| Anti-pattern | What it looks like | Why it fails | Fix |
|---|---|---|---|
| **Retry without diagnosis** | "still broken" → agent tries a different import path → still broken → tries another | no hypothesis, so no information gained per iteration | after 2 failures, stop editing and go **read**. State the hypothesis before the next edit. |
| **Infinite politeness loop** | you paste "it's still not working" ten times, adding nothing new | you are re-running the same input and expecting different output | paste the **error text** and what changed since last time. New input or no iteration. |
| **Prose gate** | "I have verified the changes are correct" | the writer graded its own work; nothing external ran | bind to an exit code. Always. |
| **Unbounded scope** | "fix the login" → agent refactors routing, adds a state library, edits 9 files | one gate, unlimited surface area on which to satisfy it | name the files that may change. Name the ones that may not. |
| **Context re-read every turn** | agent re-dumps `server.js` and `app.jsx` on every iteration | burns budget re-establishing what it already knows, and buries the new error | keep the loop's working set small — see [`02-context-engineering.md`](02-context-engineering.md) |
| **Green gate, wrong feature** | build passes, form still doesn't submit | your gate tested compilation, not behaviour | the gate must assert the thing you actually want (`curl` the endpoint, not just `pnpm build`) |
| **Gate satisfied by deletion** | build was failing on an import; agent removed the import | you rewarded "exit 0", not "works" | pair every gate with a scope constraint, or a second gate it cannot cheat |

---

## 8. The loop design worksheet

Copy this. Fill it in **before** iteration 1. If you cannot fill in "Gate command",
you are not ready to loop yet — you are ready to explore, which is a different mode.

```text
GOAL          One sentence. The observable outcome, not the code change.
              e.g. "Submitting the login form sends the credentials to the backend
                    and shows the server's response."

SIGNAL        What tells me it worked? Where does that fact come from?
              e.g. "HTTP status from POST /api/auth/login + the rendered error text"

GATE COMMAND  The exact command. Must exit nonzero on failure.
              e.g. curl -fsS -X POST localhost:5000/api/auth/login -d '...'

BASELINE      Is the gate green on untouched code right now?   [ yes / no ]
              If no, fixing the gate IS iteration 1.

MAX ITER      Hard stop. e.g. 6

STOP ON FAIL  e.g. "same error signature twice -> stop, report hypothesis"

SCOPE         Files that MAY change:   frontend/src/pages/login.jsx
                                       backend/src/server.js
              Files that MAY NOT:      everything else, especially package.json

ROLLBACK      e.g. branch feat/login-wiring, commit at each green gate,
                   `git reset --hard HEAD~1` to undo one iteration
```

---

## 9. Worked example — wiring the login form, as a loop

The repo's real next task. `login.jsx` renders a form; the backend has exactly one
route, `GET /api/health`. Here is that task run as six bounded iterations.

**Worksheet, filled in:**

- **Goal:** submitting the login form POSTs to the backend and renders the response.
- **Gate:** `curl -fsS -X POST localhost:5000/api/auth/login ...` then a manual browser check.
- **Max iter:** 6 · **Stop on fail:** same error twice · **Scope:** `login.jsx`, `server.js`
- **Rollback:** branch `feat/login-wiring`, commit at each green gate.

| # | Action | Gate command | Expected | If it fails |
|---|---|---|---|---|
| **0** | **Baseline.** Branch, install deps, confirm the gates work on *untouched* code. | `git switch -c feat/login-wiring && pnpm install && node --check backend/src/server.js` | exit 0 | fix the environment first. Never loop against a red baseline. |
| **1** | Start the backend. Confirm the existing route answers. | `curl -fsS localhost:5000/api/health` | exit 0, JSON body | not listening → check the port in `server.js` before touching anything |
| **2** | **RED.** Ask for a route that does not exist yet. | `curl -fsS -X POST localhost:5000/api/auth/login -H 'Content-Type: application/json' -d '{"email":"a@b.com","password":"x"}'` | **nonzero (404)** — this is the point | if it *passes*, your gate is wrong. Fix the gate, not the code. |
| **3** | Add `POST /api/auth/login` to `server.js`. Hardcode a 200 response — no auth logic yet. Add `express.json()` if the body is undefined. | same command as #2 | exit 0 | body `undefined` → the JSON body parser is missing. One hypothesis, one edit. |
| **4** | Make the inputs controlled in `login.jsx` (`useState` for email + password). No fetch yet. | `pnpm --filter 1on1-frontend run build`, then type in the browser | build exit 0, typing works | field won't type → you set `value` without `onChange`. Classic. One edit. |
| **5** | Wire `onSubmit` → `fetch('/api/auth/login')`. Add the Vite dev-server proxy so `/api` reaches the backend port. | submit in the browser; watch the Network tab **and** the backend terminal | request reaches the backend, response renders | 404 at the Vite port → the proxy is the bug, not your fetch |
| **6** | Error path. Send a bad body; assert the UI shows a message rather than going blank. | `curl -fsS -X POST .../api/auth/login -d '{}'` | **nonzero (400)** — and the browser shows an error | 200 on an empty body → the route validates nothing |

Notice what makes this a loop rather than a to-do list:

1. **Every row has a command that can fail.** No row is judged by reading the code.
2. **Iteration 2 expects failure.** That is not wasted — it is the only proof the gate
   can detect the thing you care about.
3. **Each row changes one thing.** When row 4 fails you know it was row 4's edit. Batch
   three changes and a red gate tells you nothing about which one broke it.
4. **Rows 3 and 6 hit the same endpoint with opposite expectations.** Happy path and
   error path are separate gates, because a route that returns 200 to everything passes
   the first and fails the second.
5. **Scope stayed at two files** across all six iterations.

---

## 10. What to practise

Three habits, in order of payoff:

1. **Write the gate command before the first edit.** If you cannot name a command that
   would fail today and pass when you're done, you do not yet have a task — you have a
   wish. That single habit prevents most looping disasters.
2. **Verify the baseline is green.** Run your gate on untouched code first. Half of all
   "the agent can't fix it" sessions are the agent trying to fix a pre-existing failure
   it never caused.
3. **Enforce "same error twice = stop".** Say it in the prompt, and obey it yourself
   when you are the one in the loop. Retrying is the most expensive way to learn
   nothing.

---

**Next:** [`04-graph-engineering.md`](04-graph-engineering.md) — a loop is one node
repeating. A graph is many nodes with dependencies, which is how you decide what can
run in parallel and what genuinely cannot.
