import { createServer } from 'vite';
import { expect, test } from './test';

test('explicit organizer correction is keyboard-safe, reviewed and compact at 320px / 125% text', async ({ page }, testInfo) => {
  const server = await createServer({ configFile: false, cacheDir: testInfo.outputPath('vite-cache'),
    server: { host: '127.0.0.1', port: 0, hmr: false }, esbuild: { jsx: 'automatic' },
    optimizeDeps: { noDiscovery: true, include: ['react', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime'] }, logLevel: 'error' });
  try {
    await server.listen();
    const address = server.httpServer?.address();
    if (!address || typeof address === 'string') throw new Error('Fictional correction server unavailable');
    const origin = `http://127.0.0.1:${String(address.port)}`;
    await page.route(`${origin}/__corrections`, (route) => route.fulfill({ contentType: 'text/html',
      body: '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="corrections-fixture"></div><script type="module" src="/tests/smoke/corrections-fixture.tsx"></script></body></html>' }));
    await page.setViewportSize({ width: 320, height: 844 });
    await page.goto(`${origin}/__corrections`);
    await page.evaluate(() => { document.documentElement.style.fontSize = '125%'; });
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { level: 2 })).toBeFocused();
    const index = dialog.getByLabel('Captured Handicap Index', { exact: true });
    await expect(index).toHaveValue('0');
    await index.fill('12.3');
    await page.keyboard.press('Escape');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Back to scores', exact: true })).toBeDisabled();
    await expect(dialog.getByRole('button', { name: 'Save audited correction', exact: true })).toBeDisabled();
    await dialog.getByLabel('Correction reason', { exact: true }).fill('Repair a fictional captured index');
    await dialog.getByRole('checkbox', { name: /I reviewed/ }).check();
    await dialog.getByRole('button', { name: 'Save audited correction', exact: true }).click();
    await expect(dialog.getByText(/Correction saved\./)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await dialog.getByRole('button', { name: 'Back to scores', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Returned to fictional scores', exact: true })).toBeVisible();
  } finally { await server.close(); }
});
