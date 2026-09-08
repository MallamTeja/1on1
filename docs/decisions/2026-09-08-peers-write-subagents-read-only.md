# Peer sessions write; subagents are read-only recon

- **Status:** accepted
- **Date:** 2026-09-08
- **Decided by:** Teja, resolving a contradiction the orchestrator surfaced

## Context

Two instructions conflicted:

- `~/.claude/CLAUDE.md` standing expectation 4: *"Use read-only recon agents
  in-session; reserve peer sessions for writes."*
- `docs/handoff/2026-09-07-orchestrator-handoff.md` §2: subagents *"are
  strictly cheaper than resuming an old peer"* for one-shot work, implying
  they may write.

The orchestrator taking over on 2026-09-08 had zero idle peer sessions
(the roster in the handoff transfer named two that had already exited), so
the choice decided whether any write work could start that morning. Per
rule 6 ("Contradictory: name the conflict and ask; don't silently pick
one") it was put to Teja as a two-option question.

## Decision

Teja chose **peers only — "I'll open sessions."** Subagents (the `Agent`
tool) do read-only recon and planning; every file write goes to a peer
session assigned by the orchestrator. Teja opens sessions on request.

The orchestrator enforces the read-only half **structurally**: recon agents
are launched as the `Plan` and `Explore` types, which have no `Write` or
`Edit` tool in their inventory. A constraint the worker *cannot* violate
beats one it merely agreed to.

## Alternatives considered

- **Subagents may write, partitioned by file.** The orchestrator's
  recommendation: unblocks work with no sessions to open, and write-ownership
  partitioning — not the peer/subagent distinction — is what actually
  prevented every collision. Rejected by Teja.
- **Peers only, revisit the rule later.** Offered; Teja picked the plain
  version.

## Consequences

- Throughput is bounded by how many sessions Teja opens. The morning's
  critical path (Parcel B) waited ≈ 10 minutes for a session to exist.
- Recon output is cheap and abundant: four read-only agents ran in the first
  hour and produced the blueprints every peer brief was built from. The
  division of labour is *agents find, peers change*.
- Each peer session accumulates context, so cost per message grows with its
  age. Prefer one parcel per session; reassign a finished session only if the
  next parcel is small or reuses its warm files.
- A peer that is denied a permission must not ask another session to do it
  — that is permission laundering, and `1on1-11` correctly refused to route
  around a denied `.env` read on this basis.

## Evidence

- Teja's answer to the orchestrator's question, 2026-09-08 ≈ 10:39 IST.
- The contradiction: `~/.claude/CLAUDE.md` line "Use read-only recon agents
  in-session; reserve peer sessions for writes" vs handoff §2.
- Agent-type tool inventories: `Plan` and `Explore` exclude `Edit`, `Write`,
  `NotebookEdit` (agent registry, 2026-09-08 session).
