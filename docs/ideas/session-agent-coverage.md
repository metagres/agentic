# Session-Agent Permission Coverage for CLI-Only Change Artifacts

| Field | Value |
|---|---|
| Origin | Session implementing CLI-only change-artifact enforcement (2026-09-09): per-agent frontmatter deny rules cover the six deployed subagents, but not the top-level session agent |
| Status | Proposed |
| Suggested change slug | `session-agent-coverage` |
| Depends on | CLI-only change-artifact enforcement (landed 2026-09-09) |
| Kind | Enhancement (deployment layer) |

## Problem

The path-scoped `docs/changes/**` file-write deny rules are emitted into the
rendered per-agent files under `<dest>/agents/`. OpenCode applies those rules
to the named subagents only. The top-level session agent that runs the
agentic-sdlc skill directly (and may not be one of the deployed agents) is
governed by the project-level `opencode.json` permission config, which this
repo does not have and which `bin/deploy-to-agent.ts` does not generate or
update. A session agent can therefore still edit `docs/changes/**` directly
with its structured file tools; only the SKILL.md prompt rule discourages it.

## Goal

Decide and implement session-level coverage: either extend the deploy to
generate/merge a project-root `opencode.json` permission block (edit rules
denying `docs/changes/**`) while respecting user-owned configuration, or
document the gap as accepted with the prompt rule as the sole session-agent
guard.

## Non-goals

- No change to the neutral permission vocabulary or the per-agent renderer
  rules (landed and working for subagents).
- No tamper-proofing ambition: bash-invoked writes remain outside tool
  permission reach regardless of the decision.

## Tradeoff / risk

Low engineering cost, but `opencode.json` is user-owned config: deploy
writing or merging it risks clobbering user settings, and a merge strategy
(pattern dedup, precedence) needs design. Shipping documentation-only
.acceptance of the gap is the zero-risk fallback.

## Kickoff

```sh
sdlc requirements --change session-agent-coverage --request "Extend deployment so the top-level session agent is also denied direct writes to docs/changes/** (project-level opencode.json permission rules), or document the gap as accepted."
```
