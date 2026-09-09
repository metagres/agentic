# Mechanical Enforcement Gate for the Docs-Current Duty

| Field | Value |
|---|---|
| Origin | Session implementing CLI-only change-artifact enforcement (2026-09-09): AGENTS.md §3 now requires every code change to end with a docs/current update, but enforcement is rule-based only |
| Status | Proposed |
| Suggested change slug | `docs-current-duty-gate` |
| Depends on | Nothing |
| Kind | Enhancement (validation pipeline) |

## Problem

AGENTS.md §3 states the docs-current duty (a code change without its
docs/current update is not done), but nothing mechanically detects a code
diff that touches `src/`/`bin/` without a corresponding `docs/current/`
update. Compliance currently relies on the agent following the rule; the
existing `npm run validate` pipeline is content-based and cannot see the
diff, and the SDLC delta gate only covers changes tracked through the
pipeline.

## Goal

Add a lightweight gate that flags code changes lacking a docs/current delta —
for example a `validate` step (or optional script) that, when the working
tree has uncommitted changes under `src/`/`bin/`, warns or fails unless
`docs/current/` is also modified, with an explicit allowlist for changes that
genuinely do not drift any documented fact.

## Non-goals

- No change to the docs-gen ownership regions or `docs:check` semantics.
- No new stage-level check type (this is repo-level hygiene, not artifact
  validation; invariant 4's catalog is for stage checks).

## Tradeoff / risk

Medium. Diff-based gates are brittle: `npm run validate` also runs on clean
trees in CI (gate must be a no-op there), false positives are likely for
changes that legitimately touch no documented behavior, and allowlist
maintenance is drift-prone. Alternatives: a git pre-commit hook, or extending
the SDLC knowledge-extraction gate. Needs a design decision before
implementation.

## Kickoff

```sh
sdlc requirements --change docs-current-duty-gate --request "Add a mechanical gate that flags code changes touching src/ or bin/ without a matching docs/current update, complementing the AGENTS.md §3 docs-current duty."
```
