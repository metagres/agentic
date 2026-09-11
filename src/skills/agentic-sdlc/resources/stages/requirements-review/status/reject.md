Reject the requirements artifact to send it back for corrections.

When mechanical checks fail, bare `--reject` records the CLI-computed mechanical failures — no input needed.
When mechanical checks pass, rejections are evidence-backed: `--reject --failures <file>` with a top-level YAML list of the failed semantic checks as {check, evidence}. The check must quote the checklist question verbatim — an undeclared name is refused and nothing is written. One entry per failed check: merge all findings of that check into the single entry's evidence (two findings joined inside one evidence string below) — a duplicate entry for a check is refused:
- check: "Does at least one acceptance criterion cover a boundary or negative case?"
  evidence: "No AC under FR-7 'rate limiting' exercises a 429 or empty-token boundary (requirements.yaml, FR-7). Also no AC covers the empty-token case for FR-3 'session tokens' (requirements.yaml, FR-3)."