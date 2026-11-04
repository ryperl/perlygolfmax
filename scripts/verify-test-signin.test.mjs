import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readSigninTarget } from './verify-test-signin.mjs';

const env = {
  TEST_FRONTEND_URL: 'https://fictional-test.3.azurestaticapps.net',
  TEST_ENTRA_SUBDOMAIN: 'fictional',
};

test('sign-in verification pins the exact isolated test and customer origins', () => {
  assert.deepEqual(readSigninTarget(env), {
    frontendOrigin: env.TEST_FRONTEND_URL,
    identityOrigin: 'https://fictional.ciamlogin.com',
  });
});

test('sign-in verification permits only the exact approved dev HTTPS origin', () => {
  assert.deepEqual(readSigninTarget({ ...env, TEST_FRONTEND_URL: 'https://dev.perlygolf.com' }), {
    frontendOrigin: 'https://dev.perlygolf.com',
    identityOrigin: 'https://fictional.ciamlogin.com',
  });
});

test('sign-in verification rejects missing, non-test, credential-bearing and malformed targets', () => {
  for (const patch of [
    { TEST_FRONTEND_URL: '' },
    { TEST_FRONTEND_URL: 'http://fictional-test.3.azurestaticapps.net' },
    { TEST_FRONTEND_URL: 'https://production.example.test' },
    { TEST_FRONTEND_URL: 'https://perlygolf.com' },
    { TEST_FRONTEND_URL: 'https://www.perlygolf.com' },
    { TEST_FRONTEND_URL: 'https://dev.perlygolf.com.attacker.example' },
    { TEST_FRONTEND_URL: 'https://dev.perlygolf.com:444' },
    { TEST_FRONTEND_URL: 'https://user:password@dev.perlygolf.com' },
    { TEST_FRONTEND_URL: 'https://dev.perlygolf.com/path' },
    { TEST_FRONTEND_URL: 'http://dev.perlygolf.com' },
    { TEST_FRONTEND_URL: 'https://fictional-test.3.azurestaticapps.net/?unexpected=value' },
    { TEST_ENTRA_SUBDOMAIN: '../other' },
  ]) {
    assert.throws(() => readSigninTarget({ ...env, ...patch }));
  }
});
