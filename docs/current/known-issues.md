# known-issues.md

## Markers

- No comment markers found in src/, bin/, or test/ (machine scan).

## Review-Justified Known Issues

<!-- docs-gen:begin id="review-justified" -->
| Location | Issue | Severity | Evidence | Disposition |
|----------|-------|----------|----------|-------------|
| docs/changes/*/plan.yaml (16 historical artifacts) | Pre-existing lint findings from the old top-level acceptance_ids format, proven present at HEAD before change remove-based-on-provenance-fields-and-gate-artifact-creation; that change's only-difference migration mandate (AC-013) intentionally left them untouched | low | docs/changes/remove-based-on-provenance-fields-and-gate-artifact-creation/implementation-review.yaml (round 1, advisory finding) | Remediation deferred to a separate follow-up change |
<!-- docs-gen:end id="review-justified" -->

## Skipped Tests

| File | Test | Reason |
| --- | --- | --- |
| none | No .skip or .only usages found in test/ | — |
## Baseline Disclaimer

Machine scan. Undocumented issues exist.
