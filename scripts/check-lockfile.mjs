import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isLocalApiWorkspace } from './lockfile-workspace.mjs';

const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));
let packages = 0;
for (const [path, dependency] of Object.entries(lock.packages)) {
  if (!path || isLocalApiWorkspace(path, dependency)) continue;
  assert.ok(dependency.resolved, `Missing resolved source: ${path}`);
  const source = new URL(dependency.resolved);
  assert.equal(source.origin, 'https://registry.npmjs.org', `Non-public package source: ${path}`);
  assert.equal(source.username, '', `Embedded credentials: ${path}`);
  assert.equal(source.password, '', `Embedded credentials: ${path}`);
  assert.equal(source.search, '', `Unexpected source parameters: ${path}`);
  assert.match(
    dependency.integrity ?? '',
    /^(sha512-[A-Za-z0-9+/]{86}==|sha1-[A-Za-z0-9+/]{27}=)$/,
    `Missing or malformed npm integrity: ${path}`,
  );
  packages++;
}
assert.ok(packages > 0, 'No locked packages were checked');
console.log(`Verified ${packages} public npm package sources with integrity hashes.`);
