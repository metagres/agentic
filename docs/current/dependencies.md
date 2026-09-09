# dependencies.md

## Key Dependencies

| Name | Version | Role | Evidence |
| --- | --- | --- | --- |
| ajv | ^8.20.0 | JSON Schema validation of stage descriptors, artifacts, and the CLI envelope | bin/validate-policies.ts, bin/validate-schemas.ts, src/scripts/lib/docs-gen/providers/api-contract.ts, src/scripts/lib/schema.ts, src/scripts/lib/validate.ts |
| ajv-formats | ^3.0.1 | format assertions (date, uri, ...) registered on ajv instances | bin/validate-policies.ts, bin/validate-schemas.ts, src/scripts/lib/docs-gen/providers/api-contract.ts, src/scripts/lib/schema.ts, src/scripts/lib/validate.ts |
| ignore | ^7.0.6 | gitignore-style pattern matching when compiling repo source into llm_context.txt | generate_context.js |
| yaml | ^2.5.1 | parses/serializes all stage config, artifacts, and policies; also parses skill frontmatter | src/scripts/lib/deploy/platforms/opencode.ts, src/scripts/lib/yaml-io.ts |

## Dev Dependencies

| Name | Version | Role | Evidence |
| --- | --- | --- | --- |
| @types/node | ^26.1.1 | Node.js type definitions for the ESM sources | package.json |
| tsup | ^8.5.1 | single-entry ESM bundle of src/scripts/sdlc.ts with all dependencies inlined | package.json, tsup.config.ts |
| typescript | ^7.0.2 | tsc --noEmit typecheck over src/ + bin/ | package.json |
