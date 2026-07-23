import test from 'node:test';
import assert from 'node:assert/strict';

import { bumpVersion } from '../../src/scripts/lib/semver.mjs';

test('bumpVersion patch', () => {
  assert.equal(bumpVersion('1.2.3', 'patch'), '1.2.4');
});

test('bumpVersion minor', () => {
  assert.equal(bumpVersion('1.2.3', 'minor'), '1.3.0');
});

test('bumpVersion major', () => {
  assert.equal(bumpVersion('1.2.3', 'major'), '2.0.0');
});

test('bumpVersion defaults missing parts', () => {
  assert.equal(bumpVersion(undefined, 'patch'), '0.0.1');
});
