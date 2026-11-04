import assert from 'node:assert/strict';

export const testCustomOrigin = 'https://dev.perlygolf.com';

export function testRedirectUris(frontend) {
  const url = new URL(frontend);
  assert.equal(url.protocol, 'https:', 'Expected the generated test HTTPS origin');
  assert.ok(url.hostname.endsWith('.azurestaticapps.net'), 'Expected the generated test hostname');
  assert.ok(!url.username && !url.password && !url.port && !url.search && !url.hash && url.pathname === '/',
    'Expected a plain generated test origin');
  return [
    `${url.origin}/?event-auth=1`,
    'http://localhost:5173/?event-auth=1',
    `${testCustomOrigin}/?event-auth=1`,
  ];
}
