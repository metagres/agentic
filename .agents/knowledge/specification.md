---
type: Specification
title: Agentic SDLC Toolkit — specification overview
description: The normative functional contract: the workflow the toolkit must support, the gates in it, and when to stop and ask; it is the only specification concept in the bundle.
tags: [specification, normative, workflow, gates]
project_slug: agentic-sdlc
version: "1.8.0"
platform_scope: opencode-only (v2)
status: draft
---

# Specification — Agentic SDLC Toolkit (Functional Core)

## About this document

This is the functional contract: what the system must do, and what it must
guarantee. It defines the logical workflow, lifecycle behavior, artifacts,
state, validation, gating, and human-only operations. It does not prescribe
how these requirements are implemented. Artifact representation, authoring
mechanisms, tooling, agent composition, and other implementation details
MAY vary, provided every requirement and invariant in this document is
satisfied.

## The workflow it must support

Gates marked [GATE] require explicit user approval before continuing.

## 0. Clarify  [GATE]
- Restate the request. Write acceptance criteria and non-goals.
- Ask about anything ambiguous. Do not assume.

## 1. Prepare
- `git status` must be clean; if not, stop and report.
- Create branch `<type>/<short-name>`.
- Run build + tests; record baseline. If red, stop and report.

## 2. Scope & classify
- List affected subprojects: frontend | backend | db | deployment.
- Type: bug fix | feature | refactor | docs | chore.
  - bug fix: reproduce with a failing test first.
  - refactor: no behaviour change; tests green before and after.
  - docs: no code changes.
- Note whether contracts change (API schema, DB schema, env/config, k8s).

## 3. Investigate (read-only)
Preference order:
1. Web standard / framework feature already in use
2. Parameterise or adapt an existing component/function
3. Generalise existing code into a neutral shared location (separate commit, behaviour unchanged)
4. New code (justify why 1-3 fail)
- Check stack conventions per subproject (see subproject AGENTS.md).
- Any new dependency, boundary change, or architecture change = big decision. [GATE]

## 4. Plan  [GATE]
- Exact files/symbols to change, order of changes (db → backend → frontend → deployment).
- Backward compatibility and migration/rollback notes.
- Test plan: what is tested, how, at which level.
- Docs to update.

## 5. Implement
- Minimal code. Only what the plan lists. New scope = stop and ask.
- Naming: unambiguous from the name alone. No abbreviations.
- Public API documented; do not export what isn't used externally.
- Respect architecture boundaries and naming conventions.
- No unrelated formatting or refactors. No secrets in code.

## 6. Verify
- Lint, type-check, tests, build all pass (commands in root AGENTS.md).
- New/changed behaviour has tests. Never weaken tests to pass.
- DB: migration applies and rolls back on a copy.
- Self-review `git diff`: no dead code, debug output, unused exports.

## 7. Report & commit  [GATE]
- Summary: changes, verification results, anything unverified, follow-ups.
- Update docs/changelog.
- Commit (conventional message) only after approval. Never push.

## Stop and ask when
Ambiguity, scope growth, boundary/library change, destructive command,
unexplained test failure, contract change not in the plan.