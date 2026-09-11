The artifact needs recovery: mechanical validation failed, or review
rejected it. Fix exactly the failures listed in `data.errors` (mechanical
findings) and `data.review_failures` ({check, evidence} from the latest
rejected round) — nothing else. Unaffected sections are not rewritten or
re-emitted.

Track rejections per check across rounds via `data.rejection_counts` (the
script maintains this). If any single check hits its second rejection,
stop recovering — do not attempt a third fix — and exit with a blocked
handoff instead of finalizing again. See Escalation below.

One line per fix in chat: `<check> -> <what changed>`. Then update through
the script and finalize again.

Finalizing a rejected artifact bumps the version (patch by default;
--bump-version major|minor|patch overrides).

Escalation (blocked handoff):
If a check has hit its second rejection, report one line — the check and
the round count — then emit this session handoff and stop:

  status: blocked
  artifact_ref: <artifact id/path>
  blocking_check: <check name>
  rejection_count: <N>
  evidence: <short summary from data.review_failures>

Do not retry a third time and do not finalize. This is the only content
that leaves the session in a blocked state — the fix attempts and review
history stay in the artifact store, addressable via artifact_ref.
Resolving a block is a human/coordinator decision, not yours to loop on.