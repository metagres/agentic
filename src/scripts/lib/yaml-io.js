import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

export function readYaml(file) {
  if (!fs.existsSync(file)) return null;

  let raw;

  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (err) {
    throw new Error(`Unable to read file ${file}: ${err.message}`);
  }

  try {
    return YAML.parse(raw);
  } catch (err) {
    throw new Error(`Invalid YAML in ${file}: ${err.message}`);
  }
}

export function writeYamlAtomic(file, data) {
  const raw = YAML.stringify(data, {
    indent: 2,
    lineWidth: 100,
  });

  const dir = path.dirname(file);
  const tmp = path.join(
    dir,
    `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`
  );

  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(tmp, raw, 'utf8');
  fs.renameSync(tmp, file);
}

export function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

export function parseYamlString(text, label = 'stdin') {
  try {
    return YAML.parse(text);
  } catch (err) {
    throw new Error(`Invalid YAML from ${label}: ${err.message}`);
  }
}
