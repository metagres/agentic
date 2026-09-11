---
name: agentic-sdlc
description: |-
  Orchestrates the full SDLC lifecycle for ANY code change in this repo — feature, bug fix, refactor, or docs. Identify the change first (creation is a separate, explicit step), then run the orchestrator loop: heartbeat with node scripts/sdlc.js status --change <name>, follow the envelope, and delegate each stage to the agent the CLI assigns.
---

## Change identification

Change identification belongs to you (the orchestrator), never to a stage step. A stage invocation without a change is a usage error. Identification is read-only: it never creates a change implicitly — creation is a separate, explicit step (init below). Scope the run to exactly one change; a request spanning several changes is split into separate runs, one change per run.

Resolve the user input:
1. Invoked without anything: never guess. Run `node scripts/sdlc.js changes` — the read-only inventory of every change. Empty list → ask what the user wants changed. Non-empty → present the in-progress changes (only in-progress changes are selectable; completed ones are archived) and ask: resume one, or start a new change?
2. Invoked with text: resolve it against the changes inventory. Exactly one plausible match → confirm "Continue <change>?". Multiple plausible matches → present the candidates and ask the user to choose before proceeding. Short imperative input (e.g. "add a retry limit") is a request seed for a new change, not a reference to an existing change; a solution proposal is re-anchored first ("What problem does X solve for you?").
3. Invoked with a file path: the file is input material (proposal doc, problem statement, transcript), never an artifact target. Read it, distill the problem statement (re-anchor solution proposals), confirm the distilled request, then proceed as with text.

For a new change:
- Derive the slug yourself — kebab-case per the CLI's validateChangeSlug rules: lowercase letters, digits, and hyphens only; starts with a letter or digit; at most 60 characters; no trailing hyphen.
- Check the derived slug against the changes inventory. On a collision, present the existing change and ask whether to resume it or create a new change; run init only after the user confirms a new change is intended. Never auto-suffix a colliding slug.
- On confirmed-new, run `node scripts/sdlc.js init --change <slug>`: it creates only the change directory (no artifacts, no stage engagement) and returns state ok with data.change_name. Run the heartbeat (loop step 1) immediately after.
- The request text collected during identification is handed to the FIRST stage delegation (requirements) as delegation context — nothing persists it at init time. If the session is lost between init and the first delegation, re-collect the context from the user.

After identifying an existing change, run the heartbeat (`node scripts/sdlc.js status --change <name>`) and engage the suggested command.

## Orchestrator loop

The skill is an orchestrator. Every cycle: read state from the CLI, delegate the stage, re-check. Never hold pipeline state in memory — the CLI is the only source. The CLI owns stage detection — do not guess which stage to run; `data.stage` names it. `--list-commands` and `--help` are inventory and debugging surfaces, not loop steps; when you need a command or flag this skill does not explain at its point of use, look it up with `node scripts/sdlc.js --list-commands`.

1. Heartbeat: from the project root run `node scripts/sdlc.js status --change <change-name>`. Resolve `scripts/sdlc.js` relative to this skill's base directory — concretely: `node <skill-base>/scripts/sdlc.js status --change <name>` — but do not cd into the skill folder: the CLI resolves `docs/changes` from the invocation working directory, which must be the project root. `--change` accepts the exact change name or a unique part of it; if resolution fails, data.available_changes lists the existing changes.
2. Read the envelope: `data.stage` names the stage to run, `data.agent` the agent bound to it, `data.suggested_command` the stage command to hand over, `state` the loop control. State values are `in_progress`, `blocked`, and `complete`; any other value → follow the top-level `instructions` field, and if that field is absent, stop and report.
3. If `state` is `complete`, the pipeline is finished for this change — emit the completion report and stop. The report names the change, lists every stage with its review verdict, enumerates the artifacts produced, includes the knowledge-extraction outputs, and lists suggested next actions. No completion report is emitted for any other state.
4. Otherwise delegate with the fixed template — nothing beyond it except the two payload exceptions below: (a) the suggested command verbatim (`data.suggested_command`), (b) the CLI path rule (resolve `scripts/sdlc.js` relative to the skill base directory, invoke from the project root, never cd into the skill folder), (c) the change name, (d) the one-line task statement: run the command, follow your envelope instructions, report one line of outcome. Payload exceptions: the collected request text rides along on the first delegation (requirements) only; on review rounds, pass the declared semantic check names verbatim from `data.semantic_checks` — never substitute positional numbers for names.
5. Delegation rule: when `data.agent` is set, delegate the stage to that agent. When the bound agent is missing or not invocable in your runtime, spawn a generic subsession for that stage — it lacks the specialist persona and permissions but remains bound by the envelope and the CLI permissions. When no delegation mechanism exists at all, that is an SDLC error: stop and report to the user; never run a stage inline. A review stage must never be reviewed by the agent that authored the artifact under review: if the bound reviewer is unavailable and you authored or delegated the artifact in this session, or cannot determine who authored it, stop and surface the conflict to the user.
6. When the subagent finishes, run the heartbeat (step 1) again and repeat. Verification is the heartbeat only: never treat the subagent's report claims as verification, and never read stage envelopes or stage artifacts. If a subagent dies mid-stage, run the heartbeat first and act on the CLI state — a stage still in_progress is re-delegated, never assumed complete.
7. `blocked` envelopes: follow the `instructions` field — rejected artifacts, open feedback, and gate failures are detours the CLI prescribes; resume the loop once resolved. A CLI invocation that exits non-zero is handled as a blocked envelope: follow its instructions. Output that is unparseable or empty is reported raw and the run stops — never guess a stage. Change artifacts under `docs/changes/` are created and modified only via the sdlc CLI — never edit them directly (deployed agents deny direct writes to that path). Payload input for authoring mutations is stdin-first: pipe YAML through a heredoc, or stage it as a temp file under `<project-root>/.tmp/sdlc/` with a unique name (e.g. `<slug>-<stage>-<epoch>-<pid>.yaml`) and pass the path. The CLI never deletes input files; delete your temp payloads when done.
8. Authoring guard: at a review-round rejection, read `data.round` on the review envelope — it equals the authoring run count. Below 3, delegate one rework round to the authoring stage agent. At 3 (the initial run plus two rework rounds), stop and escalate to the user; delegate no fourth authoring run. Without a review rejection no cycle cap applies — the loop runs without pausing.

## Worked example

```
node scripts/sdlc.js changes                             # inventory: present in-progress changes, derive the slug
node scripts/sdlc.js init --change add-retry-limit       # creation: mkdir-only, then heartbeat immediately
node scripts/sdlc.js status --change add-retry-limit     # heartbeat: read data.stage, data.agent, data.suggested_command
# delegate requirements to data.agent — fixed template + the collected request text
node scripts/sdlc.js status --change add-retry-limit     # heartbeat again: verify via CLI state only, repeat
```
