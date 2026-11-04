import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export function packageApi(workspace, destination) {
  const root = realpathSync(workspace);
  const output = resolve(root, relative(resolve(workspace), resolve(destination)));
  assert.equal(dirname(output), join(root, '.azure'), 'API package must be staged inside the ignored .azure directory');
  if (existsSync(join(root, '.azure'))) {
    assert.equal(realpathSync(join(root, '.azure')), join(root, '.azure'), 'API staging directory must not redirect outside the workspace');
  }
  assert.ok(!existsSync(output), 'API package destination already exists; choose a fresh staging directory');
  const manifest = JSON.parse(readFileSync(join(root, 'api/package.json'), 'utf8'));
  assert.equal(manifest.main, 'dist/api/src/functions.js', 'Unexpected Functions entry point');
  for (const name of Object.keys(manifest.dependencies)) {
    assert.ok(existsSync(join(root, 'node_modules', name, 'package.json')), `Missing production dependency: ${name}`);
  }
  mkdirSync(output, { recursive: true });
  for (const path of ['host.json', 'package.json', 'dist']) {
    cpSync(join(root, 'api', path), join(output, path), { recursive: true });
  }
  cpSync(join(root, 'node_modules'), join(output, 'node_modules'), {
    recursive: true,
    filter(source) {
      const path = relative(join(root, 'node_modules'), source).split(sep).join('/');
      return path !== '@perly-golf-max/api' && !path.startsWith('@perly-golf-max/api/');
    },
  });
  assert.ok(existsSync(join(output, manifest.main)), 'Compiled Functions entry point is missing');
  assert.deepEqual(readdirSync(output).sort(), ['dist', 'host.json', 'node_modules', 'package.json']);
  return output;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = dirname(dirname(fileURLToPath(import.meta.url)));
  const output = process.argv[2];
  assert.ok(output, 'Pass a fresh .azure staging directory');
  packageApi(root, output);
  console.log('Packaged compiled API and installed production dependencies; no environment or credential files copied.');
}
