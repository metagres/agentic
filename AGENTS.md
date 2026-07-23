# Project instructions

## Structure

One repository, four parts. Every command runs from the repository root. Node ≥ 22, ESM. `tsc --noEmit` covers `src` and `tests` only, so `scripts/` is neither typechecked nor unit-tested.

| Part              | What it is                                                                                                    | Verification (all must pass)                                                       |
| ----------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `src/assets/`     | The deployed definitions the code reads at runtime: stage definitions, artifact-type definitions, `workflows.yaml`, `config.yaml` | test `npm test` · smoke `node src/cli/bin/sdlc.ts stages`                            |
| `src/` + `tests/` | The toolkit. Modules are one-way: `documents` → `config` → `work-items` → `cli`, and nothing below imports from above | typecheck `npm run typecheck` · test `npm test`                                    |
| `assets/agents/`  | The agent definitions, deployed with the `dev:` frontmatter stripped and every body byte-identical           | deploy `node scripts/deploy.mjs`, then check 3 of `scripts/DEPLOY.md`               |
| `scripts/`        | The dev-time deploy entrypoint: bundles the CLI with tsup and places the deployed tree                      | the acceptance checks in `scripts/DEPLOY.md`, checks 1–8                             |

- **Change order** (dependencies first): `src/assets/` → `src/` → `assets/agents/` → `scripts/`. `assets/agents/` follows `src/` because a deployed tool is named from the CLI's own command list (`sdlc_<command>`), so renaming a command renames a tool an agent definition may name. No agent declares a permission block today, so nothing currently forces the order — it is the coupling to keep in mind, not an observed one.
- **Contracts** — the interfaces other code, systems, or agents depend on:
  - the CLI surface: command names, options, one JSON success payload on stdout, and the exit codes `0`–`5` decided in `src/cli/errors.ts`, which agents reach as the deployed `sdlc_*` tools;
  - the deployed asset schemas in `src/assets/` — a structural defect in one is a load error that halts, never a skipped entry;
  - the deployed tree shape `.opencode/{agents/, tools/sdlc.ts, tools/sdlc/sdlc.mjs, tools/sdlc/assets/}` and its file classes (`source-to-deployment`);
  - the work-item file formats: `intake.md`, `settings.yaml`, and an artifact's six toolkit fields plus its type's declared fields, with `version` a canonical digest (`src/work-items/README.md`);
  - the knowledge bundle's frontmatter, below.

## Finding things

This project indexes its own code and its documents — the knowledge bundle included — with graphify. The graph in `graphify-out/` is the map an agent walks before it reads anything.

- Query before searching: `graphify query "<question>"` for what something connects to, `--dfs` for how one thing reaches another, `graphify path "<a>" "<b>"` for the shortest path between two concepts, `graphify explain "<concept>"` for one concept in full, `graphify affected "<symbol>"` for what a change would impact.
- The query matches node labels literally, so expand the question into the graph's own vocabulary (`graphify-out/.vocab.txt`) first. Never query with a synonym recalled from memory — it returns nothing and reads as "no such thing".
- Cite what the graph returns, then open the file and confirm it. The graph is an index; the code is the truth. A path or symbol nobody opened is not evidence.
- A missing or stale graph is reported, not worked around: if `graphify-out/graph.json` is absent or older than the working tree, say so and stop depending on it. Rebuilding costs a full extraction — ask first, then `graphify update .` for code, or `/graphify --update` when documents changed too.
- `graphify-out/reflections/LESSONS.md` records preferred sources and dead ends from earlier sessions. Read it before broad research, and skip what it marks as a dead end.

## Rules for every agent

- Never push, force-push, or run destructive commands. Never commit secrets.
- Do only what the user asked or approved. If the scope grows or something is ambiguous, stop and ask.
- `.opencode/`, `node_modules/`, `package-lock.json`, and `llms.txt` are gitignored. Never commit them.
- Never hand-edit the deployed tree: `.opencode/agents/`, `.opencode/tools/` are rewritten by every deploy. `.opencode/package.json` and `.opencode/plugins/graphify.js` are hand-maintained and no deploy touches them.
- `node scripts/deploy.mjs` writes `<repo>/.opencode/` and may be run to verify a change. `--global` writes `~/.config/opencode/` and `--force` overwrites the configuration class; both need the user's approval first.
- The knowledge bundle is written by the `curator` agent alone. No other agent edits `.agents/knowledge/`.

## Knowledge base

Project facts that outlive a task live in `.agents/knowledge/`, an OKF v0.2 bundle whose entry point is `index.md`.

1. Ask the `curator` agent. It is the bundle's sole maintainer and query agent: every durable question goes to it, and it alone creates, amends, merges, or retires a concept. The graph locates a concept; the curator answers for it. Do not read the bundle wholesale, and do not write in it.
2. Binding: `code-principles`, `toolkit-layout`, `source-to-deployment` (all `Convention`), `specification/overview.md` (`Specification`), and `okf-usage.md` (`Reference`). Name the ones you relied on. There is still no architecture, glossary, or `Decision` concept, which `clarification`, `planning`, and `investigate` ask for — report them as missing rather than reading around it.
3. A concept that contradicts the code, or another concept, is reported, never silently resolved. A fact that is missing is stated as missing, never invented.
4. A new concept carries this frontmatter: `type` (required; in use `Convention`, `Reference`, `Decision`, `Specification`), `title`, `description` in one sentence, `version` as `MAJOR.MINOR.PATCH` with the minor component bumped on every substantive amendment, and `status` as `draft`, `stable`, or `deprecated`. Never `generated`; change history is git history.