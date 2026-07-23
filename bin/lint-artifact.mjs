#!/usr/bin/env node
import path from 'node:path';
import process from 'node:process';

import { parseArgs } from '../src/scripts/lib/cli.mjs';
import { readYaml } from '../src/scripts/lib/yaml-io.mjs';

import {
  validateContract,
  runChecks,
} from '../src/scripts/lib/contract-checks.mjs';

import {
  loadContract,
  makeCtx,
} from '../src/scripts/lib/context.mjs';
// sdlc-hardening: schema
import { validateArtifactSchema } from '../src/scripts/lib/schema.mjs';

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
          'node bin/lint-artifact.mjs --contract requirements --artifact docs/changes/my-change/requirements.yaml',
          'node bin/lint-artifact.mjs --contract plan --artifact docs/changes/my-change/plan.yaml --gate review',
          'node bin/lint-artifact.mjs --contract implementation --artifact docs/changes/my-change/plan.yaml --gate review',
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

const warnings = [];
const contract = loadContract(contractFile, cwd, warnings);

if (warnings.some((w) => w.code === 'CONTRACT_MISSING')) {
  console.log(
    JSON.stringify(
      {
        ok: false,
        contract: contractFile,
        gate,
        errors: [
          {
            code: 'CONTRACT_MISSING',
            message: `Could not load contract: ${contractFile}`,
          },
        ],
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
} catch (err) {
  console.log(
    JSON.stringify(
      {
        ok: false,
        contract: contractFile,
        artifact: artifactPath,
        gate,
        errors: [
          {
            code: 'ARTIFACT_PARSE_FAILED',
            message: err.message,
          },
        ],
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
} catch (err) {
  console.log(
    JSON.stringify(
      {
        ok: false,
        contract: contractFile,
        artifact: artifactPath,
        gate,
        errors: [
          {
            code: 'CONTRACT_INVALID',
            message: err.message,
          },
        ],
        warnings,
      },
      null,
      2
    )
  );

  process.exit(1);
}

let findings = [];
try {
  const schemaFindings = validateArtifactSchema(contractName, artifact, cwd);
  findings = [
    ...schemaFindings,
    ...runChecks(artifact, contract, ctx, { gate }),
  ];
} catch (err) {
  console.log(
    JSON.stringify(
      {
        ok: false,
        contract: contractFile,
        artifact: artifactPath,
        gate,
        errors: [
          {
            code: 'CHECK_RUN_FAILED',
            message: err.message,
          },
        ],
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
