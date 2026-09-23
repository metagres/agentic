// P-02 structural tests: thin entry point plus self-describing command modules.
// Parsing is citty-backed (see docs/decisions/0001); the entry still owns
// only routing, I/O, and exit, and every command still exposes the unified
// CliCommand interface plus an optional citty argsDef.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { commands } from '../../src/cli/commands/index.ts';
import { EXIT, findUnknownFlag, isHuman } from '../../src/cli/protocol.ts';
import type { CliCommand } from '../../src/cli/protocol.ts';

const PACKAGE_JSON = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
) as { version: string };

const ENTRY_SOURCE = readFileSync(new URL('../../src/cli/sdlc-cli.ts', import.meta.url), 'utf8');

const versionCommand = commands.find((command) => command.descriptor.name === '--version');
const helpCommand = commands.find((command) => command.descriptor.name === '--help');

const commandDescriptors = commands.map((command) => command.descriptor);

function stubCommand(overrides: Partial<CliCommand> & { name: string }): CliCommand {
  return {
    descriptor: {
      name: overrides.name,
      description: 'stub',
      usage: 'stub',
      example: 'stub',
    },
    triggerFlags: [],
    matches: () => false,
    run: () => '',
    ...overrides,
  };
}

describe('P-02 CLI structure', () => {
  it('entry point routes only: imports protocol and command modules', () => {
    assert.match(ENTRY_SOURCE, /from '\.\/protocol\.ts'/);
    assert.match(ENTRY_SOURCE, /from '\.\/commands\/index\.ts'/);
  });

  it('entry point holds no command logic or literals', () => {
    assert.ok(!ENTRY_SOURCE.includes('0.1.0'), 'version literal must live in commands/version.ts');
    assert.ok(
      !ENTRY_SOURCE.includes("'UNKNOWN_COMMAND'"),
      'error code literals must live in protocol constants',
    );
    assert.ok(
      !ENTRY_SOURCE.includes('INVALID_INVOCATION:'),
      'envelope construction must live in protocol helpers',
    );
    for (const literal of ["'--version'", "'--help'", "'-h'"]) {
      assert.ok(
        !ENTRY_SOURCE.includes(literal),
        `command flag ${literal} must come from the registry, not the entry`,
      );
    }
    assert.match(ENTRY_SOURCE, /findUnknownFlag/, 'flag validation comes from protocol.ts');
    assert.ok(
      !ENTRY_SOURCE.includes('HUMAN_FLAG') && !ENTRY_SOURCE.includes("includes('--human')"),
      'entry validates --human but never interprets rendering; commands resolve it via isHuman',
    );
  });

  it('rendering switch resolves from argv through one citty-backed helper', () => {
    assert.equal(isHuman(['--version', '--human']), true);
    assert.equal(isHuman(['--human', '--version']), true);
    assert.equal(isHuman(['--version']), false);
    assert.equal(isHuman(['-h']), false);
    assert.equal(isHuman([]), false);
  });

  it('known flags derive from the registry, never hand-maintained', () => {
    for (const flag of ['--human', '--version', '--help', '-h']) {
      assert.equal(findUnknownFlag([flag], commands), undefined, `registry claims ${flag}`);
    }
    for (const command of commands) {
      for (const flag of command.triggerFlags) {
        assert.equal(
          findUnknownFlag([flag], commands),
          undefined,
          `${command.descriptor.name} trigger ${flag} is known`,
        );
      }
    }
  });

  it('unknown-flag guard accepts declared flags and rejects the rest', () => {
    assert.equal(findUnknownFlag([], commands), undefined);
    assert.equal(findUnknownFlag(['--version'], commands), undefined);
    assert.equal(findUnknownFlag(['--help', '--human'], commands), undefined);
    assert.equal(findUnknownFlag(['-h'], commands), undefined);
    assert.equal(findUnknownFlag(['--bogus-flag'], commands), '--bogus-flag');
    assert.equal(
      findUnknownFlag(['--version', '--bogus-flag'], commands),
      '--bogus-flag',
    );
  });

  it('per-command citty args feed the known-flag set', () => {
    const stub = stubCommand({
      name: 'stub',
      argsDef: {
        type: { type: 'string', description: 'stub' },
        verbose: { type: 'boolean', description: 'stub', alias: 'v' },
      },
    });
    assert.equal(findUnknownFlag(['--type', 'x'], [stub]), undefined, 'string arg long flag is known');
    assert.equal(findUnknownFlag(['--verbose'], [stub]), undefined, 'boolean arg long flag is known');
    assert.equal(findUnknownFlag(['-v'], [stub]), undefined, 'single-char alias is known');
    assert.equal(
      findUnknownFlag(['--type=x'], [stub]),
      '--type=x',
      'equals-form flags stay unknown (exact-match grammar)',
    );
    assert.equal(findUnknownFlag(['--no-verbose'], [stub]), '--no-verbose');
  });

  it('exit table keeps 1 reserved and maps internal failures to 9', () => {
    assert.equal(EXIT.SUCCESS, 0);
    assert.equal(EXIT.INVALID_INVOCATION, 2);
    assert.equal(EXIT.INTERNAL, 9);
    assert.ok(!Object.values(EXIT).includes(1 as never), 'exit 1 must never be emitted');
  });

  it('entry point dispatches through the command registry', () => {
    assert.match(ENTRY_SOURCE, /\.find\(/);
    assert.match(ENTRY_SOURCE, /\.matches\(/);
    assert.match(ENTRY_SOURCE, /\.run\(/);
    assert.ok(!ENTRY_SOURCE.includes('0.1.0'), 'no literals leak into the entry point');
  });

  it('every registered command exposes the unified interface', () => {
    assert.ok(commands.length >= 2);
    for (const command of commands) {
      assert.equal(typeof command.matches, 'function', `${command.descriptor.name}.matches`);
      assert.equal(typeof command.run, 'function', `${command.descriptor.name}.run`);
      assert.ok(
        command.triggerFlags.length > 0,
        `${command.descriptor.name} declares trigger flags`,
      );
      for (const flag of command.triggerFlags) {
        assert.ok(
          command.matches([flag]),
          `${command.descriptor.name}.matches claims declared ${flag}`,
        );
      }
    }
    const version = versionCommand;
    const help = helpCommand;
    assert.ok(version && help, 'registry holds version and help commands');
    assert.ok(version.matches(['--version']), 'version claims --version');
    assert.ok(!version.matches(['--help']), 'version ignores --help');
    assert.ok(help.matches(['--help']), 'help claims --help');
    assert.ok(help.matches([]), 'help claims bare invocation');
    assert.equal(
      (JSON.parse(version.run({ args: ['--version'], commands })) as {
        version: string;
      }).version,
      PACKAGE_JSON.version,
      'version output tracks package.json without importing its literal',
    );
    assert.equal(
      version.run({ args: ['--version', '--human'], commands }).trim(),
      PACKAGE_JSON.version,
    );
    const helpJson = JSON.parse(help.run({ args: ['--help'], commands })) as {
      commands: Array<{ name: string }>;
    };
    assert.equal(helpJson.commands.length, commands.length, 'help run lists the registry');
  });
  it('every registered command is self-describing', () => {
    assert.ok(commandDescriptors.length >= 2);
    for (const descriptor of commandDescriptors) {
      for (const field of ['name', 'description', 'usage', 'example'] as const) {
        assert.equal(typeof descriptor[field], 'string', `${descriptor.name}.${field}`);
        assert.ok(descriptor[field].length > 0, `${descriptor.name}.${field} non-empty`);
      }
    }
  });

  it('help renders every registered command in both modes', () => {
    const version = versionCommand;
    const help = helpCommand;
    assert.ok(version && help, 'version and help commands registered');
    const json = JSON.parse(help.run({ args: ['--help'], commands })) as {
      commands: Array<{ name: string; description: string; usage: string; example: string }>;
    };
    assert.equal(json.commands.length, commandDescriptors.length);
    const text = help.run({ args: ['--help', '--human'], commands });
    assert.throws(() => JSON.parse(text), 'human help must not be JSON');
    for (const descriptor of commandDescriptors) {
      assert.ok(
        json.commands.some((command) => command.name === descriptor.name),
        `JSON help lists ${descriptor.name}`,
      );
      assert.ok(text.includes(descriptor.name), `text help lists ${descriptor.name}`);
    }
  });

  it('version output tracks package.json in both modes', () => {
    const version = versionCommand;
    assert.ok(version, 'version command registered');
    assert.equal(
      (JSON.parse(version.run({ args: ['--version'], commands })) as {
        version: string;
      }).version,
      PACKAGE_JSON.version,
      'JSON version matches package.json',
    );
    assert.equal(
      version.run({ args: ['--version', '--human'], commands }).trim(),
      PACKAGE_JSON.version,
      'human version is raw',
    );
  });
});
