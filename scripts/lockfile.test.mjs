import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const publicDependency = {
  version: '1.2.3',
  resolved: 'https://registry.npmjs.org/example/-/example-1.2.3.tgz',
  integrity: `sha512-${'A'.repeat(86)}==`,
};

function withLock(dependency, run) {
  const directory = mkdtempSync(join(tmpdir(), 'perly-lock-test-'));
  try {
    mkdirSync(join(directory, 'scripts'));
    for (const script of ['check-lockfile.mjs', 'public-lockfile.mjs']) {
      copyFileSync(new URL(script, import.meta.url), join(directory, 'scripts', script));
    }
    const file = join(directory, 'package-lock.json');
    writeFileSync(file, JSON.stringify({ packages: { '': {}, 'node_modules/example': dependency } }));
    run({
      file,
      execute(script) {
        return spawnSync(process.execPath, [join(directory, 'scripts', script)], { encoding: 'utf8' });
      },
    });
  } finally {
    rmSync(directory, { recursive: true });
  }
}

test('public lockfile checker accepts standard npm integrity', () => {
  for (const integrity of [publicDependency.integrity, `sha1-${'A'.repeat(27)}=`]) {
    withLock({ ...publicDependency, integrity }, ({ execute }) => {
      const result = execute('check-lockfile.mjs');
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /Verified 1 public npm package/);
    });
  }
});

test('checker rejects private URLs, credentials, query strings, and malformed integrity', () => {
  for (const patch of [
    { resolved: 'https://private.example.test/package.tgz' },
    { resolved: 'https://user:fictional@registry.npmjs.org/example.tgz' },
    { resolved: `${publicDependency.resolved}?fixture=not-a-secret` },
    { integrity: '' },
    { integrity: 'sha512-not-valid' },
  ]) {
    withLock({ ...publicDependency, ...patch }, ({ execute }) => {
      assert.notEqual(execute('check-lockfile.mjs').status, 0);
    });
  }
});

test('normalizer preserves version and integrity while creating canonical public tarball URLs', () => {
  withLock({ ...publicDependency, name: '@example/fixture', resolved: 'https://private.example.test/package.tgz' }, ({ execute, file }) => {
    const result = execute('public-lockfile.mjs');
    assert.equal(result.status, 0, result.stderr);
    const normalized = JSON.parse(readFileSync(file, 'utf8')).packages['node_modules/example'];
    assert.equal(normalized.resolved, 'https://registry.npmjs.org/@example/fixture/-/fixture-1.2.3.tgz');
    assert.equal(normalized.version, publicDependency.version);
    assert.equal(normalized.integrity, publicDependency.integrity);
    assert.equal(execute('check-lockfile.mjs').status, 0);
  });
});

test('normalizer rejects non-registry package identities and missing integrity', () => {
  for (const patch of [{ name: '../private' }, { version: 'file:../private' }, { integrity: '' }]) {
    withLock({ ...publicDependency, ...patch }, ({ execute }) => {
      assert.notEqual(execute('public-lockfile.mjs').status, 0);
    });
  }
});
