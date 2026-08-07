#!/usr/bin/env node
import path from 'node:path';
import process from 'node:process';
import { parseArgs } from '../src/scripts/lib/cli.ts';
import { readYaml } from '../src/scripts/lib/yaml-io.ts';
import { validateArtifactSchema } from '../src/scripts/lib/schema.ts';
import { checkCrossFileReferences } from '../src/scripts/lib/validators.ts';
import { makeCtx } from '../src/scripts/lib/context.ts';
import { makeError } from '../src/scripts/lib/error-catalog.ts';

function usage(code = 2) {
  console.log(
    JSON.stringify(
      {
        ok: false,
        usage:
          'Usage: lint-artifact --contract <requirements|design|plan|implementation> ' +
          '--artifact <path-to-artifact.yaml> ' +
          '[--cwd <project-root>] [--no-fail]',
        examples: [
          'node bin/lint-artifact.ts --contract requirements --artifact docs/changes/my-change/requirements.yaml',
          'node bin/lint-artifact.ts --contract plan --artifact docs/changes/my-change/plan.yaml',
          'node bin/lint-artifact.ts --contract implementation --artifact docs/changes/my-change/plan.yaml',
        ],
      },
      null,
      2
    )
  );
  process.exit(code);
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  usage(0);
}
if (!args.contract || !args.artifact) {
  usage(2);
}

const cwd = args.cwd ? path.resolve(String(args.cwd)) : process.cwd();
const contractName = String(args.contract);
const changeRoot = path.dirname(path.resolve(cwd, String(args.artifact)));

const artifactPath = path.resolve(cwd, String(args.artifact));
let artifact;
try {
  artifact = readYaml(artifactPath);
} catch (err: unknown) {
  console.log(
    JSON.stringify(
      {
        ok: false,
        contract: contractName,
        artifact: artifactPath,
        errors: [makeError('ARTIFACT_PARSE_FAILED', { message: err instanceof Error ? err.message : String(err) })],
      },
      null,
      2
    )
  );
  process.exit(1);
}

const ctx = makeCtx(cwd, changeRoot);

let findings: { finding?: string; message?: string; severity?: string }[] = [];
try {
  const schemaFindings = validateArtifactSchema(contractName, artifact, cwd);
  const refFindings = checkCrossFileReferences(contractName, artifact, changeRoot);
  findings = [
    ...schemaFindings,
    ...refFindings,
  ];
} catch (err: unknown) {
  console.log(
    JSON.stringify(
      {
        ok: false,
        contract: contractName,
        artifact: artifactPath,
        errors: [makeError('CHECK_RUN_FAILED', { message: err instanceof Error ? err.message : String(err) })],
      },
      null,
      2
    )
  );
  process.exit(1);
}

// Since we no longer have a DSL, all findings are treated as blocking by default in this script.
const blocking = findings;
const nonBlocking: any[] = []; 
const ok = blocking.length === 0;

console.log(
  JSON.stringify(
    {
      ok,
      contract: contractName,
      artifact: artifactPath,
      blocking_count: blocking.length,
      non_blocking_count: nonBlocking.length,
      blocking,
      findings,
    },
    null,
    2
  )
);

if (args['no-fail']) {
  process.exit(0);
}
process.exit(ok ? 0 : 1);