import { createServer } from 'vite';
import { expect, test } from './test';

test('one-field roster HI update retains partial-save retry and completed-round handicap at mobile widths', async ({ page }, testInfo) => {
  const server = await createServer({ configFile: false, cacheDir: testInfo.outputPath('vite-cache'),
    server: { host: '127.0.0.1', port: 0, hmr: false }, esbuild: { jsx: 'automatic' },
    optimizeDeps: { noDiscovery: true, include: ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime'] },
    logLevel: 'error' });
  const errors: string[] = [];
  page.on('pageerror', (error) => { errors.push(error.message); });
  try {
    await server.listen();
    const address = server.httpServer?.address();
    if (!address || typeof address === 'string') throw new Error('Fictional HI server did not start.');
    const origin = `http://127.0.0.1:${String(address.port)}`;
    await page.route(`${origin}/__handicap`, (route) => route.fulfill({ contentType: 'text/html',
      body: '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="hi-fixture"></div><script type="module" src="/tests/smoke/handicap-update-fixture.tsx"></script></body></html>' }));
    await page.goto(`${origin}/__handicap`);
    await page.evaluate(() => { document.documentElement.style.fontSize = '125%'; });
    const edit = page.getByRole('button', { name: 'Update Handicap Index for Fictional golfer 1', exact: true });
    await edit.click();
    const dialog = page.getByRole('dialog'), index = dialog.getByRole('textbox', { name: 'Handicap Index', exact: true });
    await expect(index).toBeEnabled();
    await expect(index).toHaveValue('4.0');
    await expect(index).toBeFocused();
    await expect(dialog.locator('input')).toHaveCount(1);
    await index.fill('14.0');
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      for (const theme of ['light', 'dark']) {
        await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        expect(await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
        for (const button of await dialog.getByRole('button').all()) {
          expect(await button.evaluate((node) => node.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
        }
      }
    }
    await dialog.getByRole('button', { name: 'Save HI', exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText('Player HI saved; updates to unfinished rounds were not confirmed.');
    await expect(index).toHaveValue('14.0');
    const state = page.getByTestId('hi-fixture-state');
    await expect(state).toHaveAttribute('data-observations', '1');
    await expect(state).toHaveAttribute('data-source', 'GHIN');
    const today = await page.evaluate(() => {
      const date = new Date();
      return `${String(date.getFullYear())}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    });
    await expect(state).toHaveAttribute('data-date', today);
    await dialog.getByRole('button', { name: 'Retry update', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(edit).toBeFocused();
    await expect(page.getByLabel('Current Handicap Index: 14.0', { exact: true })).toBeVisible();
    const ongoing = page.locator('.event-trip-round').filter({ has: page.getByRole('heading', { name: 'In progress', exact: true }) });
    const completed = page.locator('.event-trip-round').filter({ has: page.getByRole('heading', { name: 'Completed', exact: true }) });
    await expect(ongoing.getByLabel('Course handicap: 14', { exact: true })).toBeVisible();
    await expect(completed.getByLabel('Course handicap: 4', { exact: true })).toBeVisible();
    await expect(state).toHaveAttribute('data-observations', '1');
    await expect(state).toHaveAttribute('data-attempts', '2');
    await expect(state).toHaveAttribute('data-stable-retry', 'true');
    if (!process.env.CI) await page.screenshot({ path: testInfo.outputPath('handicap-update.png'), fullPage: true });
    expect(errors).toEqual([]);
  } finally { await server.close(); }
});
