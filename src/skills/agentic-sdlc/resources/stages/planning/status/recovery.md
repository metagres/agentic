The plan artifact needs recovery: mechanical validation failed, or review rejected it. Fix exactly the failures listed in `data.errors` (mechanical findings) and `data.review_failures` ({check, evidence} from the latest rejected round) — nothing else. Unaffected sections are not rewritten or re-emitted.

One line per fix in chat: `<check> -> <what changed>`. Then update through the script and finalize again.

Finalizing a rejected artifact bumps the version (patch by default; --bump-version major|minor|patch overrides).