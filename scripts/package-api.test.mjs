import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { packageApi } from './package-api.mjs';

function fixture(run) {
  const root = mkdtempSync(join(tmpdir(), 'perly-api-package-'));
  try {
    for (const path of ['api/dist/api/src', 'api/dist/src/contracts', 'node_modules/jose', 'node_modules/@perly-golf-max']) {
      mkdirSync(join(root, path), { recursive: true });
    }
    writeFileSync(join(root, 'api/package.json'), JSON.stringify({
      name: '@perly-golf-max/api', type: 'module', main: 'dist/api/src/functions.js', dependencies: { jose: '6.2.13' },
    }));
    writeFileSync(join(root, 'api/host.json'), '{"version":"2.0"}');
    writeFileSync(join(root, 'api/dist/api/src/functions.js'), 'export {};');
    writeFileSync(join(root, 'api/dist/src/contracts/events.js'), 'export {};');
    writeFileSync(join(root, 'node_modules/jose/package.json'), '{"name":"jose"}');
    symlinkSync('../../api', join(root, 'node_modules/@perly-golf-max/api'), 'dir');
    for (const name of ['.npmrc', '.env.local', 'local.settings.json']) {
      writeFileSync(join(root, 'api', name), 'fictional-sensitive-fixture');
    }
    run(root, join(root, '.azure/package'));
  } finally { rmSync(root, { recursive: true }); }
}

test('API package includes emitted shared contracts but excludes local credentials and workspace links', () => {
  fixture((root, output) => {
    packageApi(root, output);
    assert.equal(readFileSync(join(output, 'dist/api/src/functions.js'), 'utf8'), 'export {};');
    assert.ok(existsSync(join(output, 'dist/src/contracts/events.js')));
    assert.ok(existsSync(join(output, 'node_modules/jose/package.json')));
    for (const path of ['.npmrc', '.env.local', 'local.settings.json', 'node_modules/@perly-golf-max/api']) {
      assert.equal(existsSync(join(output, path)), false);
    }
  });
});

test('API packaging refuses unsafe destinations, missing dependencies and stale staging output', () => {
  fixture((root, output) => {
    assert.throws(() => packageApi(root, join(root, 'public/package')), /ignored/);
    rmSync(join(root, 'node_modules/jose'), { recursive: true });
    assert.throws(() => packageApi(root, output), /Missing production dependency/);
    assert.equal(existsSync(output), false);
  });
  fixture((root, output) => {
    packageApi(root, output);
    assert.throws(() => packageApi(root, output), /already exists/);
  });
});
