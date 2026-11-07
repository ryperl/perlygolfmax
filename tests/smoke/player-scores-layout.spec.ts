import { expect, test } from './test';
import { createServer } from 'vite';

test('assigned player entry and readonly controls work at 390 and 320 pixels', async ({ page }, testInfo) => {
  const server = await createServer({
    configFile: false, cacheDir: testInfo.outputPath('vite-cache'),
    server: { host: '127.0.0.1', port: 0, hmr: false }, esbuild: { jsx: 'automatic' },
    optimizeDeps: { noDiscovery: true, include: ['react', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime'] },
    logLevel: 'error',
  });
  try {
    await server.listen();
    const address = server.httpServer?.address();
    if (!address || typeof address === 'string') throw new Error('Fictional server did not start.');
    const origin = `http://127.0.0.1:${String(address.port)}`;
    await page.route(`${origin}/__player-fixture*`, (route) => route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="player-scores-fixture"></div><script type="module" src="/tests/smoke/player-scores-fixture.tsx"></script></body></html>',
    }));
    const errors: string[] = [];
    page.on('pageerror', (error) => { errors.push(error.message); });
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto(`${origin}/__player-fixture`);
      await expect(page.getByText(/Your assigned playing group: Group 2/)).toBeVisible();
      await page.getByRole('button', { name: 'Enter scores', exact: true }).click();
      await expect(page.getByLabel('View group')).toHaveValue('2');
      await expect(page.getByRole('textbox')).toHaveCount(4);
      const input = page.getByRole('textbox').first();
      await input.fill('7');
      await expect(input).toHaveValue('7');
      await expect(page.getByRole('button', { name: 'Save & Next Hole' })).toBeEnabled();
      await page.getByLabel('View group').selectOption('1');
      for (const field of await page.getByRole('textbox').all()) await expect(field).toBeDisabled();
      await expect(page.getByRole('button', { name: 'Save & Next Hole' })).toBeDisabled();
      await expect(page.getByText('Round details & tools', { exact: true })).toHaveCount(0);
      await page.getByRole('button', { name: 'Games', exact: true }).click();
      await expect(page.getByText(/Settings are read-only/)).toBeVisible();
      await expect(page.getByRole('button', { name: /Add game|Edit Fictional|Save game/ })).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.goto(`${origin}/__player-fixture?readonly`);
      await expect(page.getByRole('heading', { name: 'Round scorecard' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Enter scores', exact: true })).toBeDisabled();
      await page.getByRole('button', { name: 'Leaderboard', exact: true }).click();
      await expect(page.getByRole('heading', { name: /Leaderboard ·/ })).toBeVisible();
      await expect(page.getByRole('button', { name: /Configure|Update team/ })).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }
    expect(errors).toEqual([]);
  } finally { await server.close(); }
});
