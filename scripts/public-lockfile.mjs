import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';

const file = new URL('../package-lock.json', import.meta.url);
const lock = JSON.parse(readFileSync(file, 'utf8'));

for (const [path, dependency] of Object.entries(lock.packages)) {
  if (!path) continue;
  const name = dependency.name ?? path.split('node_modules/').at(-1);
  assert.match(name ?? '', /^(@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i, `Unexpected npm package name: ${path}`);
  assert.match(dependency.version ?? '', /^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/i, `Expected a published package version: ${path}`);
  assert.ok(dependency.integrity, `Missing package integrity: ${path}`);
  assert.ok(dependency.resolved, `Missing package source: ${path}`);
  const filename = name.split('/').at(-1);
  dependency.resolved = `https://registry.npmjs.org/${name}/-/${filename}-${dependency.version}.tgz`;
}

writeFileSync(file, `${JSON.stringify(lock, null, 2)}\n`);
console.log('Normalized tarball URLs to public npm without network access; versions and integrity are unchanged.');
console.log('This does not prove a package is public. Review every added dependency before committing.');
