Reject the design artifact to send it back for corrections.

When mechanical checks fail, bare `--reject` records the CLI-computed mechanical failures — no input needed.
When mechanical checks pass, rejections are evidence-backed: `--reject --failures <file>` with a top-level YAML list of the failed semantic checks as {check, evidence}. The check must quote the checklist question verbatim — an undeclared name is refused and nothing is written. One entry per failed check: merge all findings of that check into the single entry's evidence (two findings joined inside one evidence string below) — a duplicate entry for a check is refused:
- check: "Are component responsibilities clear, non-overlapping, and testable?"
  evidence: "components.api_gateway and components.auth both claim token issuance (design.yaml, components). Also no component satisfies FR-9 'retention window' (design.yaml, satisfies)."