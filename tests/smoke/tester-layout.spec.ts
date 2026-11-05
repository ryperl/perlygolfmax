import { expect, test } from './test';
import type { Page, TestInfo } from '@playwright/test';
import { createServer } from 'vite';

async function fixture(page: Page, testInfo: TestInfo, exercise: (origin: string) => Promise<void>) {
  const server = await createServer({
    configFile: false, cacheDir: testInfo.outputPath('vite-cache'),
    server: { host: '127.0.0.1', port: 0, hmr: false }, esbuild: { jsx: 'automatic' },
    optimizeDeps: { noDiscovery: true, include: ['react', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime'] },
    logLevel: 'error',
  });
  try {
    await server.listen();
    const address = server.httpServer?.address();
    if (!address || typeof address === 'string') throw new Error('Fictional tester fixture server did not start.');
    const origin = `http://127.0.0.1:${String(address.port)}`;
    await page.route(`${origin}/__tester-fixture*`, (route) => route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="tester-fixture"></div><script type="module" src="/tests/smoke/tester-fixture.tsx"></script></body></html>',
    }));
    const errors: string[] = [];
    const serviceRequests: string[] = [];
    page.on('pageerror', (error) => { errors.push(error.message); });
    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== origin || url.pathname.startsWith('/api/')) {
        serviceRequests.push(`${url.origin}${url.pathname}`);
        await route.abort();
      } else await route.fallback();
    });
    await exercise(origin);
    expect(errors).toEqual([]);
    expect(serviceRequests).toEqual([]);
  } finally { await server.close(); }
}

async function fitsViewport(page: Page, width: number) {
  expect(await page.evaluate(() => window.innerWidth)).toBe(width);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  for (const control of await page.getByRole('main').locator('input, button, select, a').all()) {
    if (!await control.isVisible()) continue;
    const box = await control.boundingBox();
    expect(box).not.toBeNull();
    if (!box) throw new Error('Visible tester control has no layout box.');
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
  }
}

test('owner tester-link controls fit narrow/enlarged layouts and support private keyboard sharing and revocation', async ({ page }, testInfo) => {
  await fixture(page, testInfo, async (origin) => {
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto(`${origin}/__tester-fixture?owner`);
      const panel = page.getByRole('region', { name: 'No-account tester access' });
      await expect(panel.getByRole('button', { name: 'Create private tester link', exact: true })).toBeEnabled();
      await expect(panel.getByText(/Anyone holding it can enter scores/)).toBeVisible();
      await expect(panel.getByText(/New links expire 7 days after creation/)).toBeVisible();
      await page.evaluate(() => { document.documentElement.style.fontSize = '125%'; });
      await fitsViewport(page, width);
      const create = panel.getByRole('button', { name: 'Create private tester link', exact: true });
      await create.focus();
      await expect(create).toBeFocused();
      expect(await create.evaluate((element) => getComputedStyle(element).outlineStyle)).not.toBe('none');
      await page.keyboard.press('Enter');
      const share = panel.getByLabel('Private tester share link');
      await expect(share).toHaveAttribute('type', 'password');
      await expect(share).toHaveAttribute('readonly', '');
      await expect(share).toHaveValue(/#tester\?event=/);
      const secret = await share.inputValue();
      expect(await page.locator('body').innerText()).not.toContain(secret);
      await share.focus();
      await expect(share).toBeFocused();
      expect(await share.evaluate((element) => getComputedStyle(element).outlineStyle)).not.toBe('none');
      await page.keyboard.press('Tab');
      await expect(panel.getByRole('button', { name: 'Copy private tester link', exact: true })).toBeFocused();
      const renew = panel.getByRole('button', { name: 'Renew tester link 1 for 7 days', exact: true });
      await renew.focus();
      await page.keyboard.press('Enter');
      await expect(panel.getByText('Tester link renewed for 7 days. The existing URL is unchanged.', { exact: true })).toBeVisible();
      await expect(share).toHaveValue(secret);
      await fitsViewport(page, width);
      const revoke = panel.getByRole('button', { name: 'Revoke tester link 1', exact: true });
      await revoke.focus();
      await page.keyboard.press('Enter');
      await expect(panel.getByText('Tester link revoked. Saved scores are preserved.', { exact: true })).toBeVisible();
      await expect(revoke).toBeDisabled();
      await expect(renew).toBeDisabled();
      await expect(share).toHaveCount(0);
      await fitsViewport(page, width);
    }
  });
});

test('guest edits any saved playing group with keyboard at narrow/enlarged widths without sign-in or organizer controls', async ({ page }, testInfo) => {
  await fixture(page, testInfo, async (origin) => {
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto(`${origin}/__tester-fixture`);
      await expect(page.getByRole('heading', { name: 'Fictional tester event', exact: true })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Round scorecard', exact: true })).toBeVisible();
      await expect(page.getByRole('link')).toHaveCount(0);
      await expect(page.getByRole('button', { name: /sign in|claim|approve|invite|tester link|setup|purse|history/i })).toHaveCount(0);
      await fitsViewport(page, width);
      await page.evaluate(() => { document.documentElement.style.fontSize = '125%'; });
      const enter = page.getByRole('button', { name: 'Enter scores', exact: true });
      await enter.focus();
      await page.keyboard.press('Enter');
      const group = page.getByRole('combobox', { name: 'View group', exact: true });
      await expect(group).toHaveValue('1');
      for (const number of [1, 2]) {
        await group.selectOption(String(number));
        const score = page.getByRole('textbox').first();
        await expect(score).toBeEnabled();
        await score.focus();
        expect(await score.evaluate((element) => getComputedStyle(element).outlineStyle)).not.toBe('none');
        await page.keyboard.press('ControlOrMeta+A');
        await page.keyboard.type(String(5 + number));
        await expect(score).toHaveValue(String(5 + number));
        const save = page.getByRole('button', { name: 'Save changes', exact: true });
        await save.focus();
        await page.keyboard.press('Enter');
        await expect(page.getByText(/1 player changes acknowledged/)).toBeVisible();
        await expect(score).toHaveValue(String(5 + number));
        await fitsViewport(page, width);
      }
      await page.getByRole('button', { name: 'Games', exact: true }).click();
      await expect(page.getByText(/Settings are read-only/)).toBeVisible();
      await expect(page.getByRole('button', { name: /Add game|Edit Fictional|Save game|Configure|Update team/i })).toHaveCount(0);
      await fitsViewport(page, width);
      await page.getByRole('combobox', { name: 'Saved round', exact: true }).selectOption({ label: 'Fictional second round' });
      await page.getByRole('button', { name: 'Enter scores', exact: true }).click();
      await expect(page.getByText(/Fictional second round · Fictional Dunes/)).toBeVisible();
      await expect(page.getByRole('textbox').first()).toHaveValue('4');
      await expect(page.getByRole('link')).toHaveCount(0);
      await fitsViewport(page, width);
      await page.getByRole('button', { name: 'Exit tester access', exact: true }).click();
      await expect(page.getByText('Fictional tester access exited.', { exact: true })).toBeVisible();
    }
  });
});
