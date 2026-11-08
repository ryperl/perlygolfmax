import { test, expect } from './test';
import { createServer } from 'vite';

test('Churchy dots dialog and acknowledged save work at 320px/125%; explicit off hides every surface', async ({ page }, testInfo) => {
  const server = await createServer({
    configFile: false, cacheDir: testInfo.outputPath('vite-cache'),
    server: { host: '127.0.0.1', port: 0, hmr: false }, esbuild: { jsx: 'automatic' },
    optimizeDeps: { noDiscovery: true, include: ['react', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime'] },
    logLevel: 'error',
  });
  try {
    await server.listen();
    const address = server.httpServer?.address();
    if (!address || typeof address === 'string') throw new Error('Fictional Churchy server unavailable');
    const origin = `http://127.0.0.1:${String(address.port)}`;
    await page.route(`${origin}/__churchy`, (route) => route.fulfill({
      contentType: 'text/html', body: `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head>
        <body><div id="churchy-fixture"></div><script type="module" src="/tests/smoke/churchy-fixture.tsx"></script></body></html>`,
    }));
    await page.setViewportSize({ width: 320, height: 844 });
    await page.goto(`${origin}/__churchy`);
    await page.evaluate(() => { document.documentElement.style.fontSize = '125%'; });
    await page.getByRole('button', { name: 'Open fictional saved round' }).click();
    await page.getByRole('button', { name: 'Enter scores', exact: true }).click();
    const trigger = page.getByRole('button', { name: 'Dots for Fictional golfer 1' });
    await trigger.click();
    const dialog = page.getByRole('dialog', { name: 'Fictional golfer 1 · Hole 1 dots' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('textbox')).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'Return to score entry' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(dialog.getByLabel(/Paree called/)).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(dialog.getByRole('button', { name: 'Return to score entry' })).toBeFocused();
    await dialog.getByLabel(/Murphy called/).check();
    await dialog.getByRole('button', { name: /Opposing team presses/ }).click();
    await dialog.getByRole('button', { name: /Calling team presses back/ }).click();
    await expect(dialog).toContainText('Murphy: 3 dots');
    expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    for (const target of await dialog.locator('button, label').all()) {
      expect(await target.evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
    }
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    await expect(trigger).toBeFocused();
    await page.getByRole('button', { name: 'Next hole', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Hole 1', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Save & Next Hole' }).click();
    await expect(page.getByRole('heading', { name: 'Hole 2', exact: true })).toBeVisible();
    for (const select of await page.getByRole('combobox').all()) {
      expect(await select.evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
    }
    await page.getByRole('button', { name: 'Games', exact: true }).click();
    const results = page.getByRole('region', { name: 'Churchy Game results' });
    await expect(results).toBeVisible();
    await expect(results).toContainText('Collects from pot: $3.00');
    await results.getByText('Saved hole receipts', { exact: true }).click();
    await expect(results).toContainText('Murphy made by Fictional golfer 1');
    await page.getByRole('button', { name: 'Toggle experimental capability' }).click();
    await page.getByRole('button', { name: 'Enter scores', exact: true }).click();
    await expect(page.getByRole('button', { name: /Dots for/ })).toHaveCount(0);
    await page.getByRole('button', { name: 'Games', exact: true }).click();
    await expect(page.getByText(/Churchy/)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Edit Fictional Skins' })).toBeVisible();
    await page.getByRole('button', { name: 'Leaderboard', exact: true }).click();
    await expect(page.getByText(/Churchy/)).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  } finally {
    await server.close();
  }
});
