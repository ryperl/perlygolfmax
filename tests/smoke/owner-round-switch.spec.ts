import { createServer } from 'vite';
import { expect, test } from './test';

test('owner switches dated rounds in Games without leaving unsaved edits or overflowing mobile controls', async ({ page }, testInfo) => {
  const server = await createServer({
    configFile: false, cacheDir: testInfo.outputPath('vite-cache'),
    server: { host: '127.0.0.1', port: 0, hmr: false }, esbuild: { jsx: 'automatic' },
    optimizeDeps: { noDiscovery: true, include: ['react', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime'] },
    logLevel: 'error',
  });
  try {
    await server.listen();
    const address = server.httpServer?.address();
    if (!address || typeof address === 'string') throw new Error('Owner round-switch server did not start.');
    const origin = `http://127.0.0.1:${String(address.port)}`;
    await page.route(`${origin}/__owner-round-switch`, (route) => route.fulfill({ contentType: 'text/html',
      body: '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="owner-round-switch"></div><script type="module" src="/tests/smoke/owner-round-switch-fixture.tsx"></script></body></html>' }));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${origin}/__owner-round-switch`);
    await page.getByRole('button', { name: 'Games', exact: true }).click();
    const picker = page.getByLabel('Round', { exact: true });
    await expect(picker.locator('option')).toHaveText(['Fictional earlier round', 'Fictional opening round']);
    await page.getByRole('button', { name: 'Add game', exact: true }).click();
    await expect(picker).toBeDisabled();
    await page.getByRole('button', { name: 'Cancel editing', exact: true }).click();
    await expect(picker).toBeEnabled();
    await page.getByRole('button', { name: 'Add game', exact: true }).click();
    await page.getByRole('button', { name: 'Save game', exact: true }).click();
    await expect(page.getByText('Game settings saved.', { exact: true })).toBeVisible();
    await picker.selectOption({ label: 'Fictional earlier round' });
    await expect(page.getByRole('heading', { name: 'Games · Fictional earlier round', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add game', exact: true })).toBeEnabled();
    await picker.selectOption({ label: 'Fictional opening round' });
    await expect(page.getByRole('heading', { name: 'Games · Fictional opening round', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Enter scores', exact: true }).click();
    await expect(page.locator('.score-round-tools')).toHaveCount(0);
    for (const name of ['Scorecards', 'Enter scores', 'Games', 'Leaderboard']) {
      await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
    }
    await expect(picker).toBeVisible();
    await expect(picker).toBeEnabled();
    expect(await picker.evaluate((element) => element.closest('details'))).toBeNull();
    expect(await picker.evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
    await picker.focus();
    await expect(picker).toBeFocused();
    expect(await picker.evaluate((element) => getComputedStyle(element).outlineStyle)).not.toBe('none');
    const groupPicker = page.getByRole('combobox', { name: 'View group', exact: true });
    for (const property of ['backgroundColor', 'color', 'borderRadius', 'fontSize'] as const) {
      expect(await picker.evaluate((element, name) => getComputedStyle(element)[name], property))
        .toBe(await groupPicker.evaluate((element, name) => getComputedStyle(element)[name], property));
    }
    await picker.selectOption({ label: 'Fictional earlier round' });
    await expect(page.getByRole('form', { name: /hole 1 entry/ })).toBeVisible();
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await page.evaluate(() => { document.documentElement.style.fontSize = '125%'; });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
  } finally { await server.close(); }
});
