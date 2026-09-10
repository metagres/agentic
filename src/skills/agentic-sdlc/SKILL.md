---
name: agentic-sdlc
description: |-
  Manages the full SDLC lifecycle via the sdlc CLI — requirements, design, planning, implementation, review, feedback, knowledge-extraction. Run scripts/sdlc.js status and follow the instructions field.
---

# Agentic SDLC

Deployed by bin/deploy-to-agent.ts from this source — edit this file, never the deployed skill (AGENTS.md §2). The `Workflows:` line below is the only deploy-time interpolation.

## Change identification

Before any stage is engaged, Change identification belongs to you (the skill), never to a stage step. A stage invocation without a change is a usage error. End identification with exactly one fully-addressed invocation: --change <name> or --request "<text>".

Handle the four invocation shapes:
1. Invoked without anything: never guess. Run `node scripts/sdlc.js changes` (read-only inventory). Empty list → ask what the user wants changed. Non-empty → present the list and ask: continue an existing change or start a new request?
2. Invoked with a text: try resolving it to exactly one existing change first (via `changes`); on a match confirm "Continue <change>?". Otherwise treat it as a request seed — when it is a solution proposal, re-anchor first ("What problem does X solve for you?") — then create via `requirements --request "<text>"`.
3. Invoked with a file path: the file is input material (proposal doc, problem statement, transcript), never an artifact target. Read it, distill the problem statement (re-anchor solution proposals), confirm the distilled request, then proceed as with a text.
4. Invoked with a few words: most likely a change reference — resolve via `changes` first; exactly one match → confirm; no match → confirm it is new work and collect the fuller request text before creating.

Invariants: one question per turn; identification uses only read-only surfaces and the question tool and never creates a change implicitly; after identifying an existing change run `status --change <name>` and engage the suggested command.

## Workflow

1. From the project root, run `node scripts/sdlc.js status --change <change-name>` (or `node scripts/sdlc.js --list-workflows`, `--help`).
   - Resolve `scripts/sdlc.js` relative to this skill's base directory, but do not cd into the skill folder: the CLI resolves `docs/changes` from the invocation working directory, which must be the project root.
   - `--change` accepts the exact change name or a unique part of it; if resolution fails, data.available_changes lists the existing changes.
2. Follow the `instructions` field in the returned envelope `{workflow, step, state, instructions, data, errors, warnings}`.
3. The CLI owns stage detection — do not guess which workflow to run.
4. A stage bound to an agent is run via that agent: check the `agent` field in `data.workflows[]`, and when it is set, delegate the stage to that agent — unless you are already that agent, or that agent is not present or not invocable in your runtime, in which case proceed running the stage yourself.
   - Review stages are always performed by their bound reviewer agent, never by the agent that authored the artifact under review.
   - When delegating a review round, pass the declared semantic check names verbatim (data.semantic_checks lists them); checklist numbers are list positions, not names.
5. Change artifacts under `docs/changes/` are created and modified only via the sdlc CLI — never edit them directly (deployed agents deny direct writes to that path).
   - Payload input for authoring mutations is stdin-first: pipe YAML through a heredoc, or stage it as a temp file under `<project-root>/.tmp/sdlc/` with a unique name (e.g. `<slug>-<stage>-<epoch>-<pid>.yaml`) and pass the path. The CLI never deletes input files; delete your temp payloads when done.

Workflows: {{WORKFLOWS}}
