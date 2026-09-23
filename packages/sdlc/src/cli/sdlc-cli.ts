// P-02 CLI entry point: argument routing, I/O, and exit only.
// Each command module exposes descriptor + matches + run (see protocol.ts
// CliCommand); this file dispatches through the registry and never implements
// command logic itself. Exit paths set process.exitCode and return — never
// process.exit(), which forces exit before pending pipe writes drain and can
// truncate the stdout JSON contract. See docs/decisions/0002.
import {
  ERROR_CODE,
  EXIT,
  findUnknownFlag,
  writeStderrEnvelope,
  writeStdout,
} from './protocol.ts';
import { commands } from './commands/index.ts';

// Entry-level test scaffolding, not a command: hidden from --help and owned
// here because no command module may claim it.
const TEST_HOOK_FLAG = '--test-internal-error';

function failInvalidInvocation(message: string, details: Record<string, unknown>): number {
  writeStderrEnvelope(ERROR_CODE.INVALID_INVOCATION, message, details);
  return EXIT.INVALID_INVOCATION;
}

function failUnknownCommand(command: string, args: readonly string[]): number {
  writeStderrEnvelope(
    ERROR_CODE.UNKNOWN_COMMAND,
    `Unknown command: ${command}`,
    { args, command },
  );
  return EXIT.INVALID_INVOCATION;
}

function failInternal(reason: unknown): void {
  process.exitCode = EXIT.INTERNAL;
  writeStderrEnvelope(ERROR_CODE.INTERNAL_ERROR, 'Internal error', {
    message: reason instanceof Error ? reason.message : String(reason),
  });
}

function isEpipe(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === 'EPIPE';
}

// A closed pipe reader (e.g. `sdlc --help | head`) is a gone consumer, not a
// failure: swallow EPIPE and keep the already-decided exit code. Any other
// stream error still surfaces as an uncaught failure mapped to exit 9 below.
for (const stream of [process.stdout, process.stderr]) {
  stream.on('error', (error: Error) => {
    if (!isEpipe(error)) {
      throw error;
    }
  });
}

function run(args: readonly string[]): number {
  // Deterministic internal-error hook for P-02 contract tests. Not a command
  // and intentionally absent from --help output.
  if (args.includes(TEST_HOOK_FLAG)) {
    throw new Error('test internal error hook');
  }

  const unknownFlag = findUnknownFlag(
    args.filter((arg) => arg !== TEST_HOOK_FLAG),
    commands,
  );
  if (unknownFlag !== undefined) {
    return failInvalidInvocation(`Unknown flag: ${unknownFlag}`, { args, flag: unknownFlag });
  }

  // --human needs no handling here: it passes validation as a global flag and
  // each command resolves rendering from argv via isHuman().
  const match = commands.find((command) => command.matches(args));
  if (match !== undefined) {
    writeStdout(match.run({ args, commands }));
    return EXIT.SUCCESS;
  }

  const positional = args.find((arg) => !arg.startsWith('-'));
  if (positional !== undefined) {
    return failUnknownCommand(positional, args);
  }

  return failInvalidInvocation('Missing command. See --help for registered commands.', { args });
}

try {
  process.exitCode = run(process.argv.slice(2));
} catch (error) {
  failInternal(error);
}

// Exit 1 is reserved by §19.1 and Node's uncaught-failure default is 1, so
// failures outside the synchronous run() window are remapped to INTERNAL (9)
// here. Returning from the handlers lets pending writes drain instead of
// truncating them.
process.on('uncaughtException', failInternal);
process.on('unhandledRejection', failInternal);
