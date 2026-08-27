// CMP-006 / API-004: fast-gate duration measurement. Dev-only helper for the
// improvement-review skill; never deployed. Plain ESM TypeScript executed
// directly by node (DEC-004) using node builtins only.
//
// Runs `npm run validate` once and emits a fixed-shape record of command,
// exit_code, duration_ms with fixed field order and fixed units. Shape
// stability is the contract: duration_ms inherently varies with machine and
// load, which DEC-008 scopes out of the byte-identity contract — timing-kind
// baseline rows compare orders of magnitude and regressions, not bytes. A
// non-zero validate exit propagates non-zero with the named cause instead of
// being swallowed.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';

const SCRIPT = 'validate_duration.ts';

/** Repository root, resolved from this file's location (src/skills/improvement-review/scripts/). */
const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..'
);

function main(): void {
  const argv = process.argv.slice(2);

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === '--verbose') {
      continue;
    } else if (arg === '--help') {
      process.stdout.write(
        `Usage: node src/skills/improvement-review/scripts/${SCRIPT} [--verbose]\n`
      );
      process.exit(0);
    } else {
      process.stderr.write(`[${SCRIPT}] usage: unknown argument '${arg}'\n`);
      process.exit(1);
    }
  }

  const command = 'npm run validate';

  const started = performance.now();
  // stdio inherit so a failing gate's own output reaches the operator
  // directly; the record below carries the exit code and duration.
  const result = spawnSync('npm', ['run', 'validate'], {
    cwd: ROOT,
    stdio: 'inherit',
  });
  const durationMs = Math.round(performance.now() - started);

  const exitCode = result.status === null ? -1 : result.status;

  const lines: string[] = [
    `script: ${SCRIPT}`,
    `arguments: ${argv.join(' ')}`,
    `command: ${command}`,
    `exit_code: ${exitCode}`,
    `duration_ms: ${durationMs}`,
    '',
  ];

  process.stdout.write(lines.join('\n'));

  if (exitCode !== 0) {
    process.stderr.write(
      `[${SCRIPT}] named cause: '${command}' exited with code ${exitCode}; ` +
        'the validate failure output is printed above. Propagating non-zero exit.\n'
    );
    process.exitCode = exitCode;
  }
}

main();
