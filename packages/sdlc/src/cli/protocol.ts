// P-02 shared CLI protocol: exit codes, error envelope, I/O helpers.
// Normative contract: docs/current/specification.md §19.1.
// Flag tokenizing is citty's parseArgs (see docs/decisions/0001); output
// rendering and the error envelope stay hand-rolled. citty parses non-strict,
// so unknown-flag rejection stays an explicit entry-level guard derived from
// the registry (collectKnownFlags/findUnknownFlag), not something the parser
// enforces.
import { parseArgs } from 'citty';
import type { ArgsDef } from 'citty';

export const EXIT = {
  SUCCESS: 0,
  // 1 is reserved and never emitted explicitly. Node maps uncaught failures
  // to 1 by default; this runtime remaps them to INTERNAL (9) instead.
  INVALID_INVOCATION: 2,
  REPOSITORY_CONFIGURATION: 3,
  AUTHORIZATION_APPROVAL: 4,
  STATE_CONFLICT: 5,
  VALIDATION: 6,
  GATE_CLOSED_BLOCKED: 7,
  RECOVERY_REQUIRED: 8,
  INTERNAL: 9,
} as const;

export const ERROR_CODE = {
  UNKNOWN_COMMAND: 'UNKNOWN_COMMAND',
  INVALID_INVOCATION: 'INVALID_INVOCATION',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export interface CommandDescriptor {
  name: string;
  description: string;
  usage: string;
  example: string;
}

// Human-readable rendering switch. GLOBAL_ARGS is the single place where
// global modifiers are defined as a citty args definition; the --human flag
// token, the isHuman() lookup, and entry-level flag validation all derive
// from it, so a rename or an added global touches exactly one literal.
// Commands resolve rendering from argv via isHuman(); the entry point never
// interprets it.
const HUMAN_ARG_NAME = 'human';

export const HUMAN_FLAG = `--${HUMAN_ARG_NAME}`;

const GLOBAL_ARGS: ArgsDef = {
  [HUMAN_ARG_NAME]: {
    type: 'boolean',
    description: 'Render human-readable stdout instead of JSON.',
  },
};

export function isHuman(args: readonly string[]): boolean {
  try {
    const parsed = parseArgs([...args], GLOBAL_ARGS);
    return parsed[HUMAN_ARG_NAME] === true;
  } catch {
    return false;
  }
}

// Flag tokens claimed by one citty args definition: --name plus declared
// aliases (-x for single chars, --xxx otherwise). Shared by the global set
// below and per-command argsDefs so both derive tokens the same way.
function flagsForArg(name: string, def: ArgsDef[string]): string[] {
  const flags = [`--${name}`];
  // Positional args declare no alias; guard with `in` since citty's ArgDef
  // union leaves the type discriminant optional.
  if (!('alias' in def) || def.alias === undefined) {
    return flags;
  }
  const aliases = Array.isArray(def.alias) ? def.alias : [def.alias];
  for (const alias of aliases) {
    flags.push(alias.length === 1 ? `-${alias}` : `--${alias}`);
  }
  return flags;
}

// Global output modifiers: derived from GLOBAL_ARGS, known to the entry
// point for flag validation only (JSON stdout by default, text with --human).
const GLOBAL_FLAGS: readonly string[] = Object.entries(GLOBAL_ARGS).flatMap(
  ([name, def]) => flagsForArg(name, def),
);

// Derived, never hand-maintained: every flag the registry claims — command
// trigger flags plus global modifiers plus per-command citty args (long names
// and aliases). The entry rejects anything else before dispatch.
function collectKnownFlags(commands: readonly CliCommand[]): Set<string> {
  const known = new Set<string>(GLOBAL_FLAGS);
  for (const command of commands) {
    for (const flag of command.triggerFlags) {
      known.add(flag);
    }
    const argsDef = command.argsDef ?? {};
    for (const [name, def] of Object.entries(argsDef)) {
      for (const flag of flagsForArg(name, def)) {
        known.add(flag);
      }
    }
  }
  return known;
}

// First raw argv token that looks like a flag but is claimed by nothing.
// Returns undefined when every flag token is known. Exact-match semantics:
// `--flag=value` forms are unknown unless a command declares them.
export function findUnknownFlag(
  args: readonly string[],
  commands: readonly CliCommand[],
): string | undefined {
  const known = collectKnownFlags(commands);
  return args.find((arg) => arg.startsWith('-') && !known.has(arg));
}

// Unified command interface: every command module exports exactly one
// CliCommand holding its descriptor, the flags it claims, a matcher over raw
// argv, and run() executing its unique logic and returning the stdout payload.
// The entry point dispatches through the registry in order and owns all I/O
// plus exit codes. The context carries raw argv (single source; commands
// derive rendering via isHuman) plus the registry for meta-commands such as
// help. Most commands ignore `commands`; the uniform shape keeps the interface
// stable as the spec §19.2 command set lands.
interface CommandContext {
  args: readonly string[];
  commands: readonly CliCommand[];
}

export interface CliCommand {
  readonly descriptor: CommandDescriptor;
  readonly triggerFlags: readonly string[];
  // Optional citty typed-args declaration for commands that take options
  // (e.g. scaffold's --type/--stages). The entry derives flag validation
  // from it; commands keep reading raw argv through matches/run.
  readonly argsDef?: ArgsDef;
  matches(args: readonly string[]): boolean;
  run(ctx: CommandContext): string;
}

interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    details: Record<string, unknown>;
  };
}

function formatEnvelope(
  code: string,
  message: string,
  details: Record<string, unknown> = {},
): string {
  const envelope: ErrorEnvelope = { error: { code, message, details } };
  return JSON.stringify(envelope);
}

export function writeStdout(value: string): void {
  process.stdout.write(value.endsWith('\n') ? value : `${value}\n`);
}

export function writeStderrEnvelope(
  code: string,
  message: string,
  details: Record<string, unknown> = {},
): void {
  process.stderr.write(`${formatEnvelope(code, message, details)}\n`);
}
