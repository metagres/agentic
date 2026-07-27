import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

export function readYaml(file: string): unknown {
  if (!fs.existsSync(file)) return null;

  let raw: string;

  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (err: unknown) {
    throw new Error(`Unable to read file ${file}: ${err instanceof Error ? err.message : String(err)}`);
  }

  try {
    return YAML.parse(raw);
  } catch (err: unknown) {
    throw new Error(`Invalid YAML in ${file}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export function writeYamlAtomic(file: string, data: unknown): void {
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

export function readStdin(): string {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

export function parseYamlString(text: string, label: string = 'stdin'): unknown {
  try {
    return YAML.parse(text);
  } catch (err: unknown) {
    throw new Error(`Invalid YAML from ${label}: ${err instanceof Error ? err.message : String(err)}`);
  }
}
