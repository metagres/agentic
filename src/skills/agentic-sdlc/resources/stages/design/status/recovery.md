The design artifact needs recovery: mechanical validation failed, or
review rejected it. Fix exactly the failures listed in `data.review_failures`
({check, evidence}) and `data.errors` (mechanical findings) — nothing
else. Unaffected sections are not rewritten or re-emitted.

One line per fix in chat: `<check> -> <what changed>`. Then update
through the script and finalize again.

Finalizing a rejected artifact bumps the version (patch by default;
--bump-version major|minor|patch overrides).