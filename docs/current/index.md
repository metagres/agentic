# /docs/current/ — Knowledge Index

| File | Purpose | When to Read | Notes |
|------|---------|--------------|-------|
| architecture.md | Tech stack, boundaries, folder responsibilities | Structural changes | Maintained by knowledge extraction |
| api-contract.md | Endpoints: method, path, auth, shapes | API changes | Maintained by knowledge extraction |
| glossary.md | Entities, fields, relationships, rules | Data layer changes | Maintained by knowledge extraction |
| capabilities.md | Features, workflows, user journeys | Feature changes | Maintained by knowledge extraction |
| conventions.md | Patterns, naming, error handling, file org | Code writing | Maintained by knowledge extraction |
| operations.md | Build, test, lint, deploy, env vars | Verification | Maintained by knowledge extraction |
| dependencies.md | Key libraries and roles | Dependency changes | Maintained by knowledge extraction |
| known-issues.md | Markers, skipped tests | Task estimation | Maintained by knowledge extraction |
| decisions.md | ADRs (reference) + cycle decisions (living) | Architectural changes | Maintained by knowledge extraction |

## Cross-Check

| # | Check | Result |
|---|-------|--------|
| 1 | Glossary entity with no API endpoint | None — each entity maps to a CLI command or bin |
| 2 | API endpoint with no glossary entity | None — commands map to Envelope, Stage Descriptor, Skill Folder, Docs Delta, Plan Task |
| 3 | Architecture module not in any other doc | None — every folder in architecture.md appears in at least one other doc |
| 4 | Known-issue location not in architecture folders | None — src/policies is in the Folder Responsibilities table |
| 5 | Capability with no related endpoint or entity | None |
| 6 | Dependency never imported in source | None — ajv/ajv-formats (src/scripts/lib/schema.ts, bin/validate-schemas.ts), yaml (src/scripts/lib/yaml-io.ts), ignore (generate_context.js) |
| 7 | Decision referencing a technology not in tech stack | None — decisions reference YAML, Node.js, tsup, all in Tech Stack |

| Note | Location | Detail |
|------|----------|--------|
| STALE-REF | src/policies/errors.yaml | ILLEGAL_STATUS_TRANSITION fix text references src/policies/lifecycle.yaml, which does not exist; see known-issues.md |