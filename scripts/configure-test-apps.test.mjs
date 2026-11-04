import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const script = fileURLToPath(new URL('./configure-test-apps.mjs', import.meta.url));

test('test registration setup is plan-only by default and creates no files', () => {
  const directory = mkdtempSync(join(tmpdir(), 'perly-identity-plan-'));
  try {
    const result = spawnSync(process.execPath, [script], { cwd: directory, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Plan only/);
    assert.deepEqual(readdirSync(directory), []);
  } finally { rmSync(directory, { recursive: true }); }
});

test('apply requires the private approved environment record before any auth operation', () => {
  const directory = mkdtempSync(join(tmpdir(), 'perly-identity-apply-'));
  try {
    const result = spawnSync(process.execPath, [script, '--apply'], { cwd: directory, encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /test-customer-deployment\.json/);
    assert.deepEqual(readdirSync(directory), []);
  } finally { rmSync(directory, { recursive: true }); }
});
