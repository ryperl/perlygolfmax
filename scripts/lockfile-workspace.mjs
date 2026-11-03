import assert from 'node:assert/strict';

export function isLocalApiWorkspace(path, dependency) {
  if (path === 'api') {
    assert.equal(dependency.name, '@perly-golf-max/api', 'Unexpected local workspace identity');
    assert.match(dependency.version ?? '', /^\d+\.\d+\.\d+$/, 'Invalid local workspace version');
    assert.equal(dependency.resolved, undefined, 'Local workspace must not have a remote source');
    assert.equal(dependency.link, undefined, 'Workspace metadata must not redirect');
    return true;
  }
  if (path === 'node_modules/@perly-golf-max/api') {
    assert.equal(dependency.link, true, 'API must be a local workspace link');
    assert.equal(dependency.resolved, 'api', 'API workspace link must stay inside this repository');
    return true;
  }
  return false;
}
