#!/usr/bin/env node
import path from 'node:path';
import process from 'node:process';
import { parseArgs } from '../src/scripts/lib/cli.ts';
import { readYaml } from '../src/scripts/lib/yaml-io.ts';
import {
  validateContract,
  runChecks,
} from '../src/scripts/lib/contract-checks.ts';
import { requireContract, makeCtx } from '../src/scripts/lib/context.ts';
import { validateArtifactSchema } from '../src/scripts/lib/schema.ts';
import { makeError } from '../src/scripts/lib/error-catalog.ts';

function usage(code = 2) {
  console.log(
    JSON.stringify(
      {
        ok: false,
        usage:
          'Usage: lint-artifact --contract <requirements|design|plan|implementation> ' +
          '--artifact <path-to-artifact.yaml> [--gate validation|review|finalize] ' +
          '[--cwd <project-root>] [--no-fail]',
        examples: [
          'node bin/lint-artifact.ts --contract requirements --artifact docs/changes/my-change/requirements.yaml',
          'node bin/lint-artifact.ts --contract plan --artifact docs/changes/my-change/plan.yaml --gate review',
          'node bin/lint-artifact.ts --contract implementation --artifact docs/changes/my-change/plan.yaml --gate review',
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
const contractFile = args['contract-file']
  ? String(args['contract-file'])
  : `${contractName}-contract.yaml`;
const gate = args.gate ? String(args.gate) : 'review';
import { WarningItem } from '../src/scripts/lib/types.ts';

const warnings: WarningItem[] = [];

let contract;
try {
  contract = requireContract(contractFile, cwd, warnings);
} catch (err: unknown) {
  console.log(
    JSON.stringify(
      {
        ok: false,
        contract: contractFile,
        gate,
        errors: [makeError('CONTRACT_MISSING', { message: err instanceof Error ? err.message : String(err) })],
        warnings,
      },
      null,
      2
    )
  );
  process.exit(1);
}

const artifactPath = path.resolve(cwd, String(args.artifact));
let artifact;
try {
  artifact = readYaml(artifactPath);
} catch (err: unknown) {
  console.log(
    JSON.stringify(
      {
        ok: false,
        contract: contractFile,
        artifact: artifactPath,
        gate,
        errors: [makeError('ARTIFACT_PARSE_FAILED', { message: err instanceof Error ? err.message : String(err) })],
        warnings,
      },
      null,
      2
    )
  );
  process.exit(1);
}

const changeRoot = path.dirname(artifactPath);
const ctx = makeCtx(cwd, changeRoot);

try {
  validateContract(contract);
} catch (err: unknown) {
  console.log(
    JSON.stringify(
      {
        ok: false,
        contract: contractFile,
        artifact: artifactPath,
        gate,
        errors: [makeError('CONTRACT_INVALID', { message: err instanceof Error ? err.message : String(err) })],
        warnings,
      },
      null,
      2
    )
  );
  process.exit(1);
}

let findings: ReturnType<typeof runChecks> = [];
try {
  const schemaFindings = validateArtifactSchema(contractName, artifact, cwd);
  findings = [
    ...schemaFindings,
    ...runChecks(artifact, contract, ctx, { gate }),
  ];
} catch (err: unknown) {
  console.log(
    JSON.stringify(
      {
        ok: false,
        contract: contractFile,
        artifact: artifactPath,
        gate,
        errors: [makeError('CHECK_RUN_FAILED', { message: err instanceof Error ? err.message : String(err) })],
        warnings,
      },
      null,
      2
    )
  );
  process.exit(1);
}

const blocking = findings.filter((f) => f.severity === 'blocking');
const nonBlocking = findings.filter((f) => f.severity !== 'blocking');
const ok = blocking.length === 0;

console.log(
  JSON.stringify(
    {
      ok,
      contract: contractFile,
      artifact: artifactPath,
      gate,
      blocking_count: blocking.length,
      non_blocking_count: nonBlocking.length,
      blocking,
      findings,
      warnings,
    },
    null,
    2
  )
);

if (args['no-fail']) {
  process.exit(0);
}
process.exit(ok ? 0 : 1);
