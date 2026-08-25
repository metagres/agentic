# api-contract.md

CLI toolkit: no HTTP endpoints. The contract surface is the `sdlc` command line and the frozen JSON envelope.

## Endpoints (CLI Commands)

| Method | Path | Auth | Request Shape | Response Shape | Source File | Schema Drift? |
|--------|------|------|---------------|----------------|-------------|---------------|
| CLI | sdlc --help / --version / --list-workflows | none (local process) | no args | envelope, data.workflows | src/scripts/sdlc.ts | No |
| CLI | sdlc <stage-id> --dir <change-dir> [kind flags] | none | --dir + flags per kind (authoring: --request, --finalize, --confirm-semantic; review: --accept, --reject, --dry-run; tasks: --task-id, --status) | frozen envelope | src/scripts/workflows/index.ts, src/scripts/lib/kinds/ | No |
| CLI | sdlc status --dir <change-dir> | none | --dir | envelope, data.pipeline | src/scripts/workflows/status.ts | No |
| CLI | sdlc feedback --dir <change-dir> --from <stage> --to <stage> --reason "..." [--resolve <FB-id>] | none | --dir, --from, --to, --reason, optional --resolve | frozen envelope | src/scripts/workflows/feedback.ts | No |
| CLI | sdlc doctor [--strict] | none | --strict optional | envelope with checks list | src/scripts/workflows/doctor.ts | No |
| CLI | node bin/deploy-to-agent.ts --dest <root> [--clean] [--skip-smoke] | none | dest, clean, skip-smoke | JSON report with skills array | bin/deploy-to-agent.ts | No |
| CLI | node bin/lint-artifact.ts <stage> <artifact> | none | stage id, artifact path | validateArtifact findings | bin/lint-artifact.ts | No |
| CLI | node bin/validate-{schemas,policies,templates}.ts | none | none | validation report; templates bin adds skills array | bin/validate-schemas.ts, bin/validate-policies.ts, bin/validate-templates.ts | No |

## Envelope

| Field | Type | Notes | Evidence |
|-------|------|-------|----------|
| workflow | string | command or stage id | src/schemas/cli-envelope.schema.yaml |
| step | string | internal step name | src/schemas/cli-envelope.schema.yaml |
| state | ok \| in_progress \| blocked \| complete | CLI response state | src/schemas/cli-envelope.schema.yaml |
| instructions | string | agent-facing next action | src/schemas/cli-envelope.schema.yaml |
| data | object | command-specific payload | src/schemas/cli-envelope.schema.yaml |
| errors | array | {code, message, fix?} from errors.yaml | src/policies/errors.yaml |
| warnings | array | advisory findings | src/policies/errors.yaml |

- Envelope top-level fields are frozen: no new fields may be added. Evidence: src/schemas/cli-envelope.schema.yaml (additionalProperties: false), AGENTS.md (invariant 8).

## Schema Reconciliation

| Schema File | Endpoints Covered | Drift |
|-------------|-------------------|-------|
| src/schemas/cli-envelope.schema.yaml | all sdlc CLI envelopes | No |
| src/schemas/stage.schema.yaml | stage.yaml descriptors (startup validation) | No |
| src/schemas/docs-delta.schema.yaml | docs-delta.yaml artifact written by knowledge-extraction | No |