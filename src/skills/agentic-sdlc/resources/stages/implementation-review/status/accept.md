Accept the implementation when mechanical checks pass and the semantic checklist raised no failures.

Run bare `--accept` — no findings file: the round is recorded accepted with `failures: []` and both valid flags true.
If mechanical checks fail, acceptance is impossible: the round is forced rejected and the artifact is flipped to rejected — fix the recorded failures first.