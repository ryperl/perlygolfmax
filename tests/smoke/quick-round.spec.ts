import { createServer } from 'vite';
import type { Page, TestInfo } from '@playwright/test';
import { expect, test } from './test';
import { contrastRatio } from './contrast';

async function openFixture(page: Page, testInfo: TestInfo, hash: string) {
  const server = await createServer({ configFile: false, cacheDir: testInfo.outputPath('vite-cache'),
    server: { host: '127.0.0.1', port: 0, hmr: false }, esbuild: { jsx: 'automatic' },
    optimizeDeps: { noDiscovery: true, include: ['react', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime'] }, logLevel: 'error' });
  try {
    await server.listen();
    const address = server.httpServer?.address();
    if (!address || typeof address === 'string') throw new Error('Fictional Quick round server unavailable');
    const origin = `http://127.0.0.1:${String(address.port)}`;
    await page.route(`${origin}/__quick-round`, (route) => route.fulfill({ contentType: 'text/html',
      body: '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="quick-round-fixture"></div><script type="module" src="/tests/smoke/quick-round-fixture.tsx"></script></body></html>' }));
    await page.goto(`${origin}/__quick-round${hash}`);
    return server;
  } catch (error) { await server.close(); throw error; }
}

for (const theme of ['light', 'dark']) {
  test(`public directory actions remain spaced, touch-sized and keyboard-accessible in ${theme}`, async ({ page }, testInfo) => {
    const server = await openFixture(page, testInfo, '#events?choose=1');
    try {
      await expect(page.getByRole('heading', { name: 'Fictional Quick round', exact: true })).toBeVisible();
      const create = page.getByRole('link', { name: 'New Quick round', exact: true });
      const refresh = page.getByRole('button', { name: 'Refresh events', exact: true });
      await page.evaluate((value) => { document.documentElement.dataset.theme = value; document.documentElement.style.fontSize = '125%'; }, theme);
      for (const width of [320, 390, 1280]) {
        await page.setViewportSize({ width, height: 900 });
        const bounds = await create.boundingBox(), secondary = await refresh.boundingBox();
        const description = await page.getByText('Open an event to enter scores, view standings and see winnings.').boundingBox();
        if (!bounds || !secondary || !description) throw new Error('Missing directory action layout');
        expect(bounds.height).toBeGreaterThanOrEqual(44);
        expect(secondary.height).toBeGreaterThanOrEqual(44);
        expect(bounds.y - description.y - description.height).toBeGreaterThanOrEqual(15);
        if (secondary.y >= bounds.y + bounds.height) expect(secondary.y - bounds.y - bounds.height).toBeGreaterThanOrEqual(11);
        else {
          expect(secondary.x - bounds.x - bounds.width).toBeGreaterThanOrEqual(19);
          expect(Math.abs(bounds.height - secondary.height)).toBeLessThanOrEqual(1);
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        if (width === 390 && !process.env.CI) await page.screenshot({ path: `coverage/quick-round-actions-${theme}.png`, fullPage: true });
      }
      const colors = await create.evaluate((element) => ({ text: getComputedStyle(element).color, background: getComputedStyle(element).backgroundColor }));
      expect(contrastRatio(colors.text, colors.background)).toBeGreaterThanOrEqual(4.5);
      await page.setViewportSize({ width: 320, height: 900 });
      await page.getByRole('button', { name: 'Archive Quick round: Fictional Quick round', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Archive Fictional Quick round?', exact: true })).toBeFocused();
      await expect(page.getByText(/Saved scores and history are retained/)).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.getByRole('button', { name: 'Archive round', exact: true }).click();
      await expect(page.getByText('No active events.', { exact: true })).toBeVisible();
      await page.keyboard.press('Tab');
      await create.focus();
      await expect(create).toBeFocused();
      await expect(create).toHaveCSS('outline-style', 'solid');
      await page.keyboard.press('Tab');
      await refresh.focus();
      await expect(refresh).toBeFocused();
      await page.keyboard.press('Shift+Tab');
      await create.focus();
      await page.keyboard.press('Enter');
      await expect(page.getByRole('heading', { name: 'Play a Quick round' })).toBeVisible();
    } finally { await server.close(); }
  });
}

for (const width of [320, 1280]) {
  test(`public Quick round retains uncertain saves and full setup at ${String(width)}px`, async ({ page }, testInfo) => {
    const server = await openFixture(page, testInfo, '#events?quick=1');
    try {
      await page.setViewportSize({ width, height: 900 });
      await expect(page.getByRole('heading', { name: 'Play a Quick round' })).toBeVisible();
      await expect(page.getByText('Public round · anyone can edit setup and games.')).toBeVisible();
      await page.getByRole('combobox', { name: 'Course', exact: true }).selectOption('ghin:301:302');
      await page.getByLabel('Default tee').selectOption('901');
      for (let index = 1; index <= 5; index++) await page.getByLabel(`Fictional golfer ${String(index)}`, { exact: true }).check();
      await page.getByLabel('Group 2 starting hole').selectOption('10');
      await page.getByRole('button', { name: 'Open full setup' }).click();
      await page.getByLabel('Event name').fill('Fictional public afternoon');
      await page.getByLabel('Tee time').fill('13:30');
      await page.evaluate(() => { document.documentElement.style.fontSize = '125%'; });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      for (const control of await page.locator('.quick-round select, .quick-round input:not([type="checkbox"]), .quick-golfer-options label').all()) {
        expect((await control.boundingBox())?.height).toBeGreaterThanOrEqual(44);
      }
      await page.getByRole('button', { name: 'Compact setup' }).click();
      await page.getByRole('button', { name: 'Save round', exact: true }).click();
      await expect(page.getByRole('alert')).toContainText('Save is not confirmed');
      await page.getByRole('button', { name: 'Open full setup' }).click();
      await expect(page.getByLabel('Event name')).toHaveValue('Fictional public afternoon');
      await expect(page.getByLabel('Event name')).toBeDisabled();
      await page.getByRole('button', { name: 'Retry same setup save' }).click();
      await expect(page.getByLabel('Scores only')).toBeChecked();
      await page.getByLabel('Scores only').uncheck();
      await expect(page.getByRole('button', { name: 'Add game' })).toBeVisible();
      await expect(page.getByLabel('Tee time')).toHaveValue('13:30');
      await expect(page.getByLabel('Group 2 starting hole')).toHaveValue('10');
      await page.getByRole('button', { name: 'Add game' }).click();
      await expect(page.getByRole('button', { name: 'Start scoring' })).toBeDisabled();
      const kinds = page.getByRole('combobox', { name: 'Game type', exact: true });
      for (const kind of ['stableford', 'ball-drop', 'skins', 'churchy']) await expect(kinds.locator(`option[value="${kind}"]`)).toHaveCount(1);
      await page.getByRole('button', { name: 'Cancel editing', exact: true }).click();
      await page.getByLabel('Scores only').check();
      await expect(page.getByRole('button', { name: 'Add game' })).not.toBeVisible();
      await expect(page.getByRole('button', { name: 'Start scoring' })).toBeEnabled();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.getByRole('button', { name: 'Start scoring' }).focus();
      await expect(page.getByRole('button', { name: 'Start scoring' })).toBeFocused();
      expect(await page.evaluate(() => ({ local: Object.keys(localStorage), session: Object.keys(sessionStorage) }))).toEqual({ local: [], session: [] });
    } finally { await server.close(); }
  });
}
