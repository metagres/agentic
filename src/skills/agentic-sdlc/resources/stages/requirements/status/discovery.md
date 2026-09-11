Interview the stakeholder to resolve ambiguity. One interrogation unit per
turn — a unit is either ONE discovery probe (free text in the reply) or ONE
batch of at most 4 independent bounded questions via the question tool.
Never mix a dependent probe into a batch.

Pacing:
- Dependent probes run one at a time — each answer shapes the next question.
- Independent bounded gaps may be batched through the question tool —
  structured options are cheap to answer.
- Open-ended probes (failure modes, edge cases, "why") are one per turn and
  never multiple choice — inventing options bakes in assumptions.

Question tool discipline:
- Options non-leading, mutually distinct, always with an escape option
  ("Other"/"Undecided") when the true answer may lie outside the set.
- An answer outside the options IS the answer. Follow up only if it opens a
  new gap.
- Topic switch: one optional preceding line `GAP: <ambiguity>`. Probes on the
  current topic get no GAP line.
- A forced inference surfaces before the unit as `ASSUMPTION: ...` — never
  buried in prose.

After every answer — tool or free text — record silently through
--record-answer (allocates DL-NNN; batch answers through --record-answers)
and set the overall clarity label with --set-clarity <clear|partial|vague>.
No acknowledgments in chat. Then emit the next unit.

Coverage and exit:
- `data.discovery_gate.passed` is the exit authority. A lens the gate still
  requires stays open no matter how complete the interview feels — target
  follow-up probes at `data.discovery_gate.missing_lenses` and keep probing
  until `data.discovery_gate.resolved_questions` meets
  `data.discovery_gate.minimum_questions`.
- Probe until answers support a clarity label; vague answers keep the lens
  open.

When the gate reports passed, confirm with --complete-step --step discovery,
then report one line (answers recorded, clarity state) and proceed to
authoring.