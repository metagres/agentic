# Verification

Applies when finishing any change: checks to run, tests to keep green,
docs and comments to update.

1. **Verify through execution, layered.** Typecheck, then unit and
   structure tests, then integration and contract tests, then build, then
   smoke-test the real artifact. Each layer catches what the previous one
   cannot; a change is done only when all layers pass.
2. **Update the words in the same edit as the code.** A comment, decision
   record, or document that a change invalidates rots from that moment —
   fix it before moving on, in the same change.
3. **Comments explain why, not what.** Record the reasoning a reader cannot
   reconstruct: why a guard is manual, why a default was overridden, why a
   seam exists. Never narrate mechanics the code already shows, and never
   leave a comment the edit has made false.

Example: replacing hand-rolled parsing updates the module header comment to
name the library, the decision record, and why the unknown-flag guard
remains manual — verified by running both test suites plus a built-binary
smoke test before declaring the migration complete.
