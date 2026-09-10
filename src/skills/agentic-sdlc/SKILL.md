---
name: agentic-sdlc
description: |-
  Orchestrates the full SDLC lifecycle for ANY code change in this repo — feature, bug fix, refactor, or docs. Before making any code change: run node scripts/sdlc.js changes to identify or create the change, then run node scripts/sdlc.js status --change <name> and follow the envelope instructions field, delegating each stage (requirements, design, planning, implementation, per-stage reviews, knowledge-extraction) to the agent the CLI assigns.
---

# Agentic SDLC

Deployed by bin/deploy-to-agent.ts from this source — edit this file, never the deployed skill (AGENTS.md §2). The `Commands:` line below is the only deploy-time interpolation.

## Change identification

Before any stage is engaged, Change identification belongs to you (the skill), never to a stage step. A stage invocation without a change is a usage error. End identification with exactly one fully-addressed invocation: --change <name> or --request "<text>".

Handle the four invocation shapes:
1. Invoked without anything: never guess. Run `node scripts/sdlc.js changes` (read-only inventory). Empty list → ask what the user wants changed. Non-empty → present the list and ask: continue an existing change or start a new request?
2. Invoked with a text: try resolving it to exactly one existing change first (via `changes`); on a match confirm "Continue <change>?". Otherwise treat it as a request seed — when it is a solution proposal, re-anchor first ("What problem does X solve for you?") — then create via `requirements --request "<text>"`.
3. Invoked with a file path: the file is input material (proposal doc, problem statement, transcript), never an artifact target. Read it, distill the problem statement (re-anchor solution proposals), confirm the distilled request, then proceed as with a text.
4. Invoked with a few words: most likely a change reference — resolve via `changes` first; exactly one match → confirm; no match → confirm it is new work and collect the fuller request text before creating.

Invariants: identification uses only read-only surfaces and the question tool and never creates a change implicitly; after identifying an existing change run `status --change <name>` and engage the suggested command.

## Orchestrator loop

The skill is an orchestrator. Every cycle: read state from the CLI, delegate the stage, re-check. Never hold pipeline state in memory — the CLI is the only source.

1. Heartbeat: from the project root run `node scripts/sdlc.js status --change <change-name>`. Resolve `scripts/sdlc.js` relative to this skill's base directory, but do not cd into the skill folder: the CLI resolves `docs/changes` from the invocation working directory, which must be the project root. `--change` accepts the exact change name or a unique part of it; if resolution fails, data.available_changes lists the existing changes.
2. Read the envelope: `data.stage` names the stage to run, `data.agent` the agent bound to it, `data.suggested_command` the stage command to hand over, `state` the loop control.
3. If `state` is `complete`, the pipeline is finished for this change — report and stop.
4. Otherwise delegate: hand the subagent the `data.suggested_command`; the subagent runs it and follows its own envelope instructions. When delegating a review round, pass the declared semantic check names verbatim (`data.semantic_checks`; `--list-semantic-checks` prints them); checklist numbers are list positions, not names.
5. Delegation rule: when `data.agent` is set, delegate the stage to that agent — unless you are already that agent, or that agent is not present or not invocable in your runtime, in which case run the stage inline yourself. A review stage must never be reviewed by the agent that authored the artifact under review: if the bound reviewer is unavailable and you authored the artifact, stop and surface the conflict to the user.
6. When the subagent or inline subsession finishes, run the heartbeat (step 1) again and repeat until `state` is `complete`.
7. `blocked` envelopes: follow the `instructions` field — rejected artifacts, open feedback, and gate failures are detours the CLI prescribes; resume the loop once resolved.

The CLI owns stage detection — do not guess which stage to run. `--list-commands` and `--help` are inventory and debugging surfaces, not loop steps.

Change artifacts under `docs/changes/` are created and modified only via the sdlc CLI — never edit them directly (deployed agents deny direct writes to that path).
   - Payload input for authoring mutations is stdin-first: pipe YAML through a heredoc, or stage it as a temp file under `<project-root>/.tmp/sdlc/` with a unique name (e.g. `<slug>-<stage>-<epoch>-<pid>.yaml`) and pass the path. The CLI never deletes input files; delete your temp payloads when done.

Commands: {{COMMANDS}}
