import assert from 'node:assert/strict';
import { test } from 'node:test';
import { testCustomOrigin, testRedirectUris } from './test-origins.mjs';

test('callbacks retain generated/local entries and add only the exact approved dev callback', () => {
  assert.equal(testCustomOrigin, 'https://dev.perlygolf.com');
  assert.deepEqual(testRedirectUris('https://fictional.3.azurestaticapps.net/'), [
    'https://fictional.3.azurestaticapps.net/?event-auth=1',
    'http://localhost:5173/?event-auth=1',
    'https://dev.perlygolf.com/?event-auth=1',
  ]);
});

test('callback configuration rejects non-generated, wildcard and non-origin URLs', () => {
  for (const target of [
    'http://fictional.3.azurestaticapps.net',
    'https://perlygolf.com',
    'https://*.perlygolf.com',
    'https://fictional.3.azurestaticapps.net.attacker.example',
    'https://user:password@fictional.3.azurestaticapps.net',
    'https://fictional.3.azurestaticapps.net:444',
    'https://fictional.3.azurestaticapps.net/path',
    'https://fictional.3.azurestaticapps.net/?event-auth=1',
    'https://fictional.3.azurestaticapps.net/#events',
    '',
  ]) assert.throws(() => testRedirectUris(target));
});
