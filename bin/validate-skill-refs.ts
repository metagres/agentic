#!/usr/bin/env node
/**
 * Skill-reference drift gate (FR-017, API-004): every command id and flag
 * written in a SKILL.md under src/skills as an sdlc CLI invocation must exist
 * in the live registries — command ids against listCommands() plus the aliases
 * map, flags against the union of the help.ts flag tables plus the top-level
 * --list-commands, --help, --cwd.
 *
 * Extraction (DEC-004) is regex-based and scoped to the sdlc CLI surface: a
 * token run whose command token is bare `sdlc` or a path ending in /sdlc.js
 * or /sdlc.ts, extending to the end of the enclosing line or code span. The
 * run is read as an invocation when the token after the command token is a
 * flag, or a command-shaped id inside a code span or fenced code block —
 * prose runs ("the sdlc CLI", "an sdlc invocation ends the run", "sdlc ...",
 * "<stage> templates") are skipped, which keeps bare --<flag> tokens outside
 * sdlc contexts (e.g. the improvement-review helper scripts' own --verbose
 * flags) out of scope by construction. No exemption list exists: a miss fails
 * the run naming the file, the line, and the offending reference.
 *
 * bin/validate-agents-md.ts pattern: standalone bin script, JSON findings,
 * non-zero exit on any finding. Wired as validate:skill-refs inside
 * npm run validate (after validate:templates). This is a repo gate, not a
 * stage check — the stage-check catalog is not extended.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { listCommands, aliases } from '../src/scripts/commands/index.ts';
import {
  AUTHORING_FLAGS,
  REVIEW_FLAGS,
  TASKS_FLAGS,
  AGGREGATOR_FLAGS,
  INIT_FLAGS,
  STATUS_FLAGS,
  CHANGES_FLAGS,
  FEEDBACK_FLAGS,
  DOCTOR_FLAGS,
} from '../src/scripts/lib/help.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// The validator resolves the stage registry from the repo root regardless of
// the invocation working directory.
process.chdir(root);

const COMMAND_TOKEN = /^(?:sdlc|.*\/sdlc\.(?:js|ts))$/;
const FLAG_TOKEN = /^--([a-z][a-z0-9-]*)$/;
// Command ids are lowercase kebab-case (stage ids and cross-cutting ids).
const COMMAND_SHAPED = /^[a-z][a-z0-9-]*$/;

const KNOWN_FLAGS: Set<string> = new Set([
  ...Object.keys(AUTHORING_FLAGS),
  ...Object.keys(REVIEW_FLAGS),
  ...Object.keys(TASKS_FLAGS),
  ...Object.keys(AGGREGATOR_FLAGS),
  ...Object.keys(INIT_FLAGS),
  ...Object.keys(STATUS_FLAGS),
  ...Object.keys(CHANGES_FLAGS),
  ...Object.keys(FEEDBACK_FLAGS),
  ...Object.keys(DOCTOR_FLAGS),
  // Top-level flags handled by sdlc.ts itself.
  'list-commands',
  'help',
  'cwd',
]);

interface InvocationRef {
  line: number;
  command: string | null;
  flags: string[];
}

/**
 * Splits a fenced code block into the lines inside ``` fences. Fenced lines
 * count as code-span context for the invocation lookahead.
 */
function fencedLines(content: string): Set<number> {
  const fenced = new Set<number>();
  const lines = content.split('\n');
  let inside = false;
  for (let i = 0; i < lines.length; i += 1) {
    if (/^\s*```/.test(lines[i])) {
      inside = !inside;
      continue;
    }
    if (inside) fenced.add(i);
  }
  return fenced;
}

/**
 * Extracts the sdlc invocation references from one SKILL.md body. Each line
 * is split into code-span / prose segments; a command token inside a code
 * span is bounded by the span, one in prose (or a fenced line) by the line.
 */
function extractInvocationRefs(content: string): InvocationRef[] {
  const refs: InvocationRef[] = [];
  const fenced = fencedLines(content);
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i += 1) {
    const segments = lines[i].split('`');

    for (let s = 0; s < segments.length; s += 1) {
      const inCodeSpan = s % 2 === 1;
      const tokens = segments[s].trim().split(/\s+/).filter(Boolean);

      for (let t = 0; t < tokens.length; t += 1) {
        if (!COMMAND_TOKEN.test(tokens[t])) continue;

        const rest = tokens.slice(t + 1);
        if (rest.length === 0) break; // command token with no run — prose

        const next = rest[0];
        const flagMatch = FLAG_TOKEN.exec(next);
        const commandShaped = COMMAND_SHAPED.test(next);

        // Invocation lookahead: a flag always reads as an invocation; a
        // command-shaped id only inside a code span or fenced block, so
        // prose runs ("an sdlc invocation ends the run") stay skipped.
        if (!flagMatch && !(commandShaped && (inCodeSpan || fenced.has(i)))) break;

        refs.push({
          line: i + 1,
          command: commandShaped ? next : null,
          flags: rest
            .map((tok) => FLAG_TOKEN.exec(tok)?.[1])
            .filter((name): name is string => Boolean(name)),
        });
        break; // one invocation context per command token
      }
    }
  }

  return refs;
}

function main(): void {
  const knownCommands: Set<string> = new Set([
    ...listCommands().map((entry) => entry.id),
    ...Object.keys(aliases),
  ]);

  const findings: { file: string; line: number; check: string; message: string }[] = [];
  const skillsDir = path.join(root, 'src', 'skills');

  if (!fs.existsSync(skillsDir)) {
    console.log(
      JSON.stringify({ ok: false, findings: [{ file: 'src/skills', check: 'existence', message: 'src/skills directory is missing' }] }, null, 2)
    );
    process.exit(1);
  }

  for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue;

    const skillMd = path.join(skillsDir, entry.name, 'SKILL.md');
    if (!fs.existsSync(skillMd)) continue;

    const rel = `src/skills/${entry.name}/SKILL.md`;
    const content = fs.readFileSync(skillMd, 'utf8');

    for (const ref of extractInvocationRefs(content)) {
      if (ref.command && !knownCommands.has(ref.command)) {
        findings.push({
          file: rel,
          line: ref.line,
          check: 'command-reference',
          message: `Unknown sdlc command '${ref.command}' — not in listCommands() or the aliases map.`,
        });
      }
      for (const flag of ref.flags) {
        if (!KNOWN_FLAGS.has(flag)) {
          findings.push({
            file: rel,
            line: ref.line,
            check: 'flag-reference',
            message: `Unknown sdlc flag '--${flag}' — not in any help.ts flag table or the top-level flags.`,
          });
        }
      }
    }
  }

  console.log(JSON.stringify({ ok: findings.length === 0, findings }, null, 2));
  process.exit(findings.length === 0 ? 0 : 1);
}

main();
