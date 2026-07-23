#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { readYaml } from '../src/scripts/lib/yaml-io.mjs';

import {
  validateContract,
  runChecks,
} from '../src/scripts/lib/contract-checks.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const contractsDir = path.join(root, 'src', 'contracts');

if (!fs.existsSync(contractsDir)) {
  console.error(`Missing contracts directory: ${contractsDir}`);
  process.exit(1);
}

const contractFiles = fs
  .readdirSync(contractsDir)
  .filter((file) => file.endsWith('.yaml'))
  .sort();

const ctx = {
  loadFile() {
    return null;
  },
  fileExists() {
    return false;
  },
  readFile() {
    return null;
  },
  changedFiles() {
    return [];
  },
};

const results = [];
let failed = false;

for (const file of contractFiles) {
  const contractPath = path.join(contractsDir, file);

  try {
    const contract = readYaml(contractPath);

    validateContract(contract);

    // Smoke-run the contract against an empty artifact under common gates.
    // This catches handler runtime errors without requiring a full artifact.
    runChecks({}, contract, ctx, { gate: 'validation' });
    runChecks({}, contract, ctx, { gate: 'review' });
    runChecks({}, contract, ctx, { gate: 'finalize' });

    results.push({
      file,
      ok: true,
    });
  } catch (err) {
    failed = true;

    results.push({
      file,
      ok: false,
      error: err.message,
    });
  }
}

console.log(
  JSON.stringify(
    {
      ok: !failed,
      contracts: results,
    },
    null,
    2
  )
);

process.exit(failed ? 1 : 0);
