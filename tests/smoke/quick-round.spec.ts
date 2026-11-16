import { createServer } from 'vite';
import { expect, test } from './test';

for (const width of [320, 1280]) {
  test(`public Quick round retains uncertain saves and full setup at ${String(width)}px`, async ({ page }, testInfo) => {
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
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${origin}/__quick-round#events?quick=1`);
      await expect(page.getByRole('heading', { name: 'Play a Quick round' })).toBeVisible();
      await expect(page.getByText('Public round · anyone can edit setup and games.')).toBeVisible();
      await page.getByRole('combobox', { name: 'Course', exact: true }).selectOption('ghin:301:302');
      await page.getByLabel('Default tee').selectOption('901');
      for (let index = 1; index <= 5; index++) await page.getByLabel(`Fictional golfer ${String(index)}`, { exact: true }).check();
      await page.getByLabel('Group 2 starting hole').selectOption('10');
      await page.getByRole('button', { name: 'Open full setup' }).click();
      await page.getByLabel('Event name').fill('Fictional public afternoon');
      await page.getByLabel('Tee time').fill('13:30');
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
