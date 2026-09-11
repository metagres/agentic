First regenerate the mechanical parts of docs/current: run npm run docs:generate. Whole-file generated documents (dependencies.md, known-issues.md, decisions.md) and marker-delimited regions in the mixed documents are machine-owned — never edit them by hand; docs:check in the fast gate enforces freshness.

Then apply each remaining listed delta to its target_doc under docs/current, editing in place at the delta's anchor. Only judgment content is delta-managed now: capabilities, conventions, glossary business rules, architecture prose, api-contract behavioral bullets, operations baselines, and canon sections. A delta whose target is a generated file or region is refused by the CLI with DELTA_TARGETS_GENERATED_REGION — regenerate instead.

If the envelope carries DOCS_CURRENT_MISSING, docs/current does not exist: the CLI warns and skips delta target validation — there are no target docs to apply deltas to, so report the missing directory and stop. The CLI never creates docs/current.

One applied delta looks like:
target_doc `docs/current/capabilities.md`, anchor `## SDLC Goals`: insert the delta's statement under that heading; when a statement already covers it, update or merge instead of appending.

After updating the docs, run: {{SDLC}} knowledge-extraction --change {{change_name}} --complete
Report the finished step in one line: how many deltas were applied across how many docs.