import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, writeJson, EXIT } from '../lib/cli.mjs';
import { makeError } from '../lib/error-catalog.mjs';
import {
resolveRootOrError,
ResolveRootError,
} from '../lib/resolve-root.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));

function findDir(name, cwd) {
const candidates = [
path.resolve(scriptDir, '..', name),
path.resolve(scriptDir, '..', '..', name),
path.resolve(scriptDir, '..', '..', '..', name),
path.resolve(cwd, 'src', name),
path.resolve(cwd, name),
];
return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function findManifest() {
const candidates = [
path.resolve(scriptDir, '..', 'manifest.json'),
path.resolve(scriptDir, '..', '..', 'manifest.json'),
path.resolve(scriptDir, '..', '..', '..', 'manifest.json'),
];
for (const candidate of candidates) {
if (fs.existsSync(candidate)) return candidate;
}
return null;
}

export function runDoctor(argv) {
const args = parseArgs(argv);
const cwd = args.cwd ? path.resolve(String(args.cwd)) : process.cwd();
const strict = Boolean(args.strict);

const checks = [];
const errors = [];
const warnings = [];

function addCheck(id, passed, details = '') {
checks.push({ id, passed, details });
}

const nodeMajor = Number(process.versions.node.split('.')[0]);
if (Number.isInteger(nodeMajor) && nodeMajor >= 20) {
addCheck('node_version', true, process.versions.node);
} else {
addCheck('node_version', false, process.versions.node);
errors.push(
makeError('NODE_VERSION_UNSUPPORTED', {
message: `Node ${process.versions.node} is not supported. Use Node 20 or newer.`,
})
);
}

const contractsDir = findDir('contracts', cwd);
if (contractsDir) {
addCheck('contracts_available', true, contractsDir);
} else {
addCheck('contracts_available', false, 'No contracts directory found');
errors.push({
...makeError('CONTRACT_MISSING'),
message: 'No contracts directory found.',
});
}

const schemasDir = findDir('schemas', cwd);
if (schemasDir) {
addCheck('schemas_available', true, schemasDir);
const envelopeSchema = path.join(schemasDir, 'cli-envelope.schema.yaml');
if (fs.existsSync(envelopeSchema)) {
addCheck('cli_envelope_schema', true, envelopeSchema);
} else {
addCheck('cli_envelope_schema', false, envelopeSchema);
errors.push({
...makeError('SCHEMAS_MISSING'),
message: 'cli-envelope.schema.yaml not found.',
});
}
} else {
addCheck('schemas_available', false, 'No schemas directory found');
errors.push({
...makeError('SCHEMAS_MISSING'),
message: 'No schemas directory found.',
});
}

const policiesDir = findDir('policies', cwd);
if (policiesDir) {
addCheck('policies_available', true, policiesDir);
} else {
addCheck('policies_available', false, 'No policies directory found');
errors.push({
...makeError('POLICIES_MISSING'),
message: 'No policies directory found.',
});
}

const templatesDir = findDir('templates', cwd);
if (templatesDir) {
addCheck('templates_available', true, templatesDir);
} else {
addCheck('templates_available', false, 'No templates directory found');
errors.push({
...makeError('TEMPLATES_MISSING'),
message: 'No templates directory found.',
});
}

const manifestPath = findManifest();
if (manifestPath) {
try {
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const requiredFields = [
'name',
'version',
'runtimeDir',
'skillsDir',
'cliPath',
];
const missing = requiredFields.filter(
(field) => manifest[field] === undefined
);
if (missing.length > 0) {
addCheck('deployed_manifest', false, manifestPath);
errors.push(
makeError('MANIFEST_INVALID', {
message: `Manifest is missing fields: ${missing.join(', ')}`,
})
);
} else {
addCheck('deployed_manifest', true, manifestPath);
}
} catch (err) {
addCheck('deployed_manifest', false, manifestPath);
errors.push(makeError('MANIFEST_INVALID', { message: err.message }));
}
} else {
addCheck('deployed_manifest', true, 'skipped; not a deployed runtime');
}

if (args.dir) {
try {
const changeRoot = resolveRootOrError(String(args.dir), { cwd });
addCheck('change_dir', true, changeRoot);
} catch (err) {
addCheck('change_dir', false, String(args.dir));
if (err instanceof ResolveRootError) {
errors.push(
makeError(
err.candidates && err.candidates.length > 0
? 'AMBIGUOUS_CHANGE_DIR'
: 'CHANGE_DIR_NOT_FOUND',
{
message: err.message,
candidates: err.candidates || [],
}
)
);
} else {
errors.push(makeError('INTERNAL_ERROR', { message: err.message }));
}
}
}

const docsIndex = path.join(cwd, 'docs', 'current', 'index.md');
if (fs.existsSync(docsIndex)) {
addCheck('docs_index_present', true, docsIndex);
} else {
addCheck('docs_index_present', false, docsIndex);
const issue = makeError('DOCS_INDEX_MISSING');
if (strict) {
errors.push(issue);
} else {
warnings.push(issue);
}
}

const state = errors.length > 0 ? 'blocked' : 'ok';
const instructions =
errors.length > 0
? 'Doctor found blocking configuration problems.'
: strict
? 'Doctor checks passed in strict mode.'
: 'Doctor checks passed.';

writeJson(
{
workflow: 'doctor',
step: 'check',
state,
instructions,
data: {
cwd,
strict,
checks,
...(args.dir ? { change_dir: String(args.dir) } : {}),
},
errors,
warnings,
},
EXIT.ok
);
}
