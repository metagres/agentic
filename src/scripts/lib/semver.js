export function bumpVersion(version, kind = 'patch') {
  const parts = String(version || '0.0.0').split('.');

  const major = Number.parseInt(parts[0] || '0', 10);
  const minor = Number.parseInt(parts[1] || '0', 10);
  const patch = Number.parseInt(parts[2] || '0', 10);

  if (kind === 'major') {
    return `${major + 1}.0.0`;
  }

  if (kind === 'minor') {
    return `${major}.${minor + 1}.0`;
  }

  return `${major}.${minor}.${patch + 1}`;
}
