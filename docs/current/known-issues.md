# known-issues.md

## Markers

| Location | Marker | Context (±2 lines) | Severity | Evidence |
|----------|--------|--------------------|----------|----------|
| src/policies/errors.yaml (ILLEGAL_STATUS_TRANSITION) | STALE-REF (machine scan) | fix text: "Follow the lifecycle defined in src/policies/lifecycle.yaml." — that file does not exist; the code is also never emitted by engine code (only checked for presence in review.ts) | cosmetic | src/policies/errors.yaml, src/scripts/lib/kinds/review.ts |

- No TODO, FIXME, HACK, XXX, BUG, or DEPRECATED markers found in src/, bin/, or test/ (machine scan).

## Review-Justified Known Issues

| Location | Issue | Severity | Evidence | Disposition |
|----------|-------|----------|----------|-------------|
| docs/changes/*/plan.yaml (16 historical artifacts) | Pre-existing lint findings from the old top-level acceptance_ids format, proven present at HEAD before change remove-based-on-provenance-fields-and-gate-artifact-creation; that change's only-difference migration mandate (AC-013) intentionally left them untouched | low | docs/changes/remove-based-on-provenance-fields-and-gate-artifact-creation/implementation-review.yaml (round 1, advisory finding) | Remediation deferred to a separate follow-up change |

## Skipped Tests

| File | Test | Reason |
|------|------|--------|
| none | No .skip or .only usages found in test/ | — |

## Baseline Disclaimer

Machine scan. Undocumented issues exist.