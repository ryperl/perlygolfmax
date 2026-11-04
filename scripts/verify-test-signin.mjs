import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { testCustomOrigin } from './test-origins.mjs';

export function readSigninTarget(env) {
  assert.ok(env.TEST_FRONTEND_URL, 'Missing test frontend URL');
  const url = new URL(env.TEST_FRONTEND_URL);
  assert.equal(url.protocol, 'https:', 'Test frontend must use HTTPS');
  assert.ok(url.hostname.endsWith('.azurestaticapps.net') || url.origin === testCustomOrigin,
    'Expected the isolated Azure test frontend or exact approved dev origin');
  assert.ok(!url.username && !url.password && !url.port && !url.search && !url.hash && url.pathname === '/', 'Expected a plain test origin');
  assert.match(env.TEST_ENTRA_SUBDOMAIN ?? '', /^[a-z0-9-]+$/, 'Missing or invalid test customer subdomain');
  return {
    frontendOrigin: url.origin,
    identityOrigin: `https://${env.TEST_ENTRA_SUBDOMAIN}.ciamlogin.com`,
  };
}

export async function verifyTestSignin(target) {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(`${target.frontendOrigin}/#events`, { waitUntil: 'domcontentloaded' });
    const signIn = page.getByRole('button', { name: 'Sign in', exact: true });
    await signIn.waitFor({ state: 'visible', timeout: 30000 });
    await signIn.click();
    await page.waitForURL((url) => url.origin === target.identityOrigin, {
      waitUntil: 'domcontentloaded', timeout: 30000,
    });
    await page.getByRole('textbox').first().waitFor({ state: 'visible', timeout: 30000 });
    assert.equal(new URL(page.url()).origin, target.identityOrigin);
    console.log('Verified actual deployed Sign in reaches the customer form. No email or code was submitted.');
  } finally { await browser.close(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await verifyTestSignin(readSigninTarget(process.env));
}
