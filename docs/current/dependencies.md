# dependencies.md

## Key Dependencies

| Name | Version | Role | Evidence |
|------|---------|------|----------|
| ajv | ^8.20.0 | JSON Schema validation of stage descriptors, artifacts, and the CLI envelope | src/scripts/lib/schema.ts, src/scripts/lib/validate.ts, bin/validate-schemas.ts, bin/validate-policies.ts |
| ajv-formats | ^3.0.1 | format assertions (date, uri, ...) registered on ajv instances | src/scripts/lib/schema.ts, bin/validate-schemas.ts |
| yaml | ^2.5.1 | parses/serializes all stage config, artifacts, and policies; also parses skill frontmatter | src/scripts/lib/yaml-io.ts, bin/validate-templates.ts |
| ignore | ^7.0.6 | gitignore-style pattern matching when compiling repo source into llm_context.txt | generate_context.js |

## Dev Dependencies

| Name | Version | Role | Evidence |
|------|---------|------|----------|
| typescript | ^7.0.2 | tsc --noEmit typecheck over src/ + bin/ | package.json (scripts.typecheck), tsconfig.json |
| tsup | ^8.5.1 | single-entry ESM bundle of src/scripts/sdlc.ts with all dependencies inlined | tsup.config.ts |
| @types/node | ^26.1.1 | Node.js type definitions for the ESM sources | package.json |