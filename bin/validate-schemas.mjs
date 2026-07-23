#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { readYaml } from '../src/scripts/lib/yaml-io.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const schemasDir = path.join(root, 'src', 'schemas');
const contractsDir = path.join(root, 'src', 'contracts');

const ajv = new Ajv({
  allErrors: true,
  strict: false,
});

try {
  addFormats(ajv);
} catch {
  // Optional.
}

const results = [];
let failed = false;

if (!fs.existsSync(schemasDir)) {
  console.error(`Missing schemas directory: ${schemasDir}`);
  process.exit(1);
}

const schemaFiles = fs
  .readdirSync(schemasDir)
  .filter((file) => file.endsWith('.yaml'))
  .sort();

for (const file of schemaFiles) {
  const schemaPath = path.join(schemasDir, file);
  try {
    const schema = readYaml(schemaPath);
    ajv.compile(schema);
    results.push({ file, ok: true });
  } catch (err) {
    failed = true;
    results.push({ file, ok: false, error: err.message });
  }
}

let contractMetaValidate = null;
try {
  const contractMetaSchema = readYaml(
    path.join(schemasDir, 'contract-meta.schema.yaml')
  );
  contractMetaValidate = ajv.compile(contractMetaSchema);
} catch (err) {
  failed = true;
  results.push({
    file: 'contract-meta.schema.yaml',
    ok: false,
    error: err.message,
  });
}

const contractResults = [];
if (contractMetaValidate && fs.existsSync(contractsDir)) {
  const contractFiles = fs
    .readdirSync(contractsDir)
    .filter((file) => file.endsWith('.yaml'))
    .sort();

  for (const file of contractFiles) {
    const contractPath = path.join(contractsDir, file);
    try {
      const contract = readYaml(contractPath);
      const valid = contractMetaValidate(contract);
      if (!valid) {
        failed = true;
      }
      contractResults.push({
        file,
        ok: Boolean(valid),
        errors: valid ? [] : contractMetaValidate.errors,
      });
    } catch (err) {
      failed = true;
      contractResults.push({ file, ok: false, error: err.message });
    }
  }
}

console.log(
  JSON.stringify(
    {
      ok: !failed,
      schemas: results,
      contracts: contractResults,
    },
    null,
    2
  )
);

process.exit(failed ? 1 : 0);
