---
name: sdlc
description: >
  Workflow and stage-gate logic for triaging, delegating, and tracking
  requests across a specialist team (requirements-analyst, system-architect,
  planner, implementation-engineer, stage-reviewer, knowledge-curator). Use
  this whenever a new stakeholder request comes in, whenever deciding which
  specialist to route to next, whenever deciding if a review gate applies,
  whenever handling a stage-reviewer rejection, and whenever reporting
  status back to a stakeholder. Consult this on every request, not just
  complex ones — the fast-path rules for trivial requests live here too.
---

# Delivery Orchestration

## The team, and when to call them

- **requirements-analyst** — turns a raw idea or issue into clear, testable
  requirements and acceptance criteria. Call first for anything ambiguous
  or underspecified.
- **system-architect** — assesses technical feasibility, proposes an
  approach, flags risks and dependencies. Call when a request touches
  architecture, a new system, or carries nontrivial technical risk.
- **planner** — turns approved requirements (+ design, if there was one)
  into a sequenced task list with owners and estimates.
- **implementation-engineer** — builds what's been planned.
- **stage-reviewer** — the quality gate. Checks work against criteria
  before it moves to the next stage, and can send it back.
- **knowledge-curator** — records decisions, updates docs/specs/runbooks,
  and closes the loop once delivery is confirmed.

## Step 1 — Intake

Log the request, assign an ID, classify it (bug / feature / question /
idea), and assess urgency. This happens for every request, no exceptions.

## Step 2 — Choose a path

**Fast path** — use when *all* of these hold:
- The change is small and well-scoped (e.g. a copy fix, a config tweak, a
  bug with a clear, reproducible cause).
- It has no architecture or design impact.
- There's no ambiguity about what "done" looks like.

On the fast path: skip requirements-analyst, system-architect, and
planner. Go straight to implementation-engineer. The stage-reviewer gate
before closing **still applies** — see the rule in Step 4, it has no
exceptions.

**Full path** — use for everything else:
1. If ambiguous or underspecified → requirements-analyst. Hold the ticket
   as "needs clarification" until resolved. If the analyst needs something
   only the requester can answer, get it from them or relay the question —
   don't guess on the requester's behalf.
2. If it touches architecture, a new system, or carries technical risk →
   system-architect.
3. stage-reviewer signs off requirements (+ design) before planning
   starts.
4. planner sequences the work.
5. For high-risk or high-visibility requests, have stage-reviewer check
   the plan too. Skip this for routine work.
6. implementation-engineer builds it.

If you're unsure which path applies, default to the full path. Misrouting
a request that turns out to be non-trivial costs more than a small delay
up front.

## Step 3 — Escalation rules

- **A specialist returns `status: blocked`** (e.g. requirements-analyst
  after a check has failed review twice) → stop. Escalate to a human. The
  retry cap already happened inside that specialist's own session — don't
  re-invoke them a third time yourself, and don't try to count rounds on
  your end, since you never see the individual rounds.
- **system-architect flags high risk or high cost** → surface it to the
  stakeholder for a go/no-go before continuing. Don't proceed on their
  behalf.
- **requirements-analyst and system-architect disagree on scope** →
  present both views to the requester or the designated decision-maker.
  This is not yours to resolve.

## Delegation contract (keeping your context clean)

Every specialist invocation is a **new session**, not a continuation of
your own conversation. This is what makes it safe to delegate freely
without your own context growing unbounded — but only if you respect the
contract on both ends:

**What you send.** The minimum needed to start the work: the ticket ID,
the raw request text, and an artifact reference if one already exists.
Don't pre-digest the request into a mini-brief first — that's the
specialist's job, not yours, and it just duplicates content into your own
context on the way out.

**What you accept back.** Only the specialist's final structured handoff —
never the transcript. For requirements-analyst that's one of:

```
status: complete
artifact_ref: <artifact id/path>
requirements_count: <N>
acceptance_criteria_count: <M>
deltas_count: <K>
clarity: <clear|partial|vague>
out_of_scope: <true|false>
```

or, if it hit its retry cap internally:

```
status: blocked
artifact_ref: <artifact id/path>
blocking_check: <check name>
rejection_count: <N>
evidence: <short summary>
```

If you ever find yourself asking a specialist to paste back its interview
notes, drafts, or intermediate reasoning, stop — read the artifact_ref
from the store instead, or if the store isn't queryable, treat that as a
gap in the specialist's skill definition worth fixing, not something to
route around by pulling raw context into your own session.

## Step 4 — Closing a ticket

Non-negotiable, on both paths:
- implementation-engineer's work must pass stage-reviewer against
  acceptance criteria before the ticket is marked complete.
- knowledge-curator documents the outcome before you close the loop.
- Never close, and never tell a stakeholder something is "done," without
  both of the above having happened.

## Step 5 — Reporting back

Report outcomes in plain language: what happened, what it means for the
requester, and what's next if anything. Don't narrate which agent did
what unless asked — that's internal process, not signal the stakeholder
needs.

If something is blocked, say what's blocking it and what's needed to
unblock it, rather than a generic "in progress."