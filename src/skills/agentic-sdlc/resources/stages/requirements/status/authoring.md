Synthesize the artifact from the recorded discovery. No interviewing here —
if authoring exposes an unresolved question, record it via --record-answer
and ask the stakeholder with one free-text probe (Discovery protocol
applies). Out of scope: straight to the out_of_scope section.

Chain script calls silently. As you author:
- Assumptions: every assumption implied by the request and discovery
  answers, classified verified or unverified.
- Acceptance criteria: every criterion in Given-When-Then form, each with a
  category (happy, edge, negative, boundary), nested in the
  acceptance_criteria array of the FR/NFR it verifies. Cover every category
  for core behaviors. No promotion or back-fill pass: an example is authored
  inside its owning requirement or it does not enter the artifact.
- Requirements: EARS form ("When <trigger>, the system shall <response>") or
  an equally unambiguous pattern. Every requirement testable.
- Use `data.next_ids` for FR/NFR/AC ids.
- Delta: determine affected living docs; append via --append-delta
  (targets: `data.delta_allowed_target_docs`) or include in
  --update-artifact. Knowledge extraction dedupes.

Mechanical checks (CLI-enforced; every finding blocks finalize and review —
the full table lives in docs/current/conventions.md):
- unique-ids: FR/NFR/AC/DL ids unique per array and across the AC union
- given-when-then: every AC statement in Given/When/Then form
- forbidden-words: no vague words — fast, simple, easy, robust, seamless,
  intuitive, optimal, gracefully, user-friendly, appropriately, "it
  works", "it handles", "as needed"

Write through --update-artifact. Report one line: artifact updated
(N requirements, M criteria, K deltas).