import { test, expect } from './test';
import { createServer } from 'vite';

test('event skins explicit setup, per-round saved wins, exact pot and readonly at 320px / 125% text', async ({ page }, testInfo) => {
  const server = await createServer({
    configFile: false, cacheDir: testInfo.outputPath('vite-cache'),
    server: { host: '127.0.0.1', port: 0, hmr: false }, esbuild: { jsx: 'automatic' },
    optimizeDeps: { noDiscovery: true, include: ['react', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime'] },
    logLevel: 'error',
  });
  try {
    await server.listen();
    const address = server.httpServer?.address();
    if (!address || typeof address === 'string') throw new Error('Fictional event skins server unavailable.');
    const origin = `http://127.0.0.1:${String(address.port)}`;
    await page.route(`${origin}/__event-skins`, (route) => route.fulfill({
      contentType: 'text/html', body: '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="event-skins-fixture"></div><script type="module" src="/tests/smoke/event-skins-fixture.tsx"></script></body></html>',
    }));
    await page.setViewportSize({ width: 320, height: 844 });
    await page.goto(`${origin}/__event-skins`);
    await page.evaluate(() => { document.documentElement.style.fontSize = '125%'; });
    await expect(page.getByText('Event skins is not configured.')).toBeVisible();
    for (const target of await page.locator('.event-skins-settings').locator('button, a, label').all()) {
      expect(await target.evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
    }
    const enabled = page.getByRole('checkbox', { name: 'Enable event-wide net skins' });
    await enabled.focus();
    await page.keyboard.press('Space');
    await expect(enabled).toBeChecked();
    await page.getByRole('button', { name: 'Save event skins settings' }).click();
    await expect(page.getByRole('heading', { name: 'Fictional Open · Event-wide skins' })).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: 'skins awarded' })).toContainText('3 skins awarded');
    const standings = page.getByRole('list', { name: 'Event skins standings' });
    await expect(standings).toContainText('Fictional golfer 1');
    await expect(standings).not.toContainText('Fictional golfer 2');
    for (const number of [1, 2, 3]) await expect(standings).toContainText(`Fictional Round ${String(number)}`);
    await expect(page.getByText(/Only when net ties, actual gross birdie or better/)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    await page.getByRole('button', { name: 'Fictional purse', exact: true }).click();
    await page.getByRole('button', { name: 'Configure purse', exact: true }).click();
    await page.getByLabel('Planned budget amount').fill('100.01');
    await page.getByRole('button', { name: 'Add award pool' }).click();
    await page.getByLabel('Pool 1 name', { exact: true }).fill('Fictional Event Skins');
    const source = page.getByRole('combobox', { name: 'Pool 1 source', exact: true });
    await source.selectOption('event-skins');
    await expect(page.getByLabel('Event skins pot amount')).toHaveValue('');
    await expect(page.getByRole('button', { name: 'Save purse', exact: true })).toBeDisabled();
    for (const select of await page.getByRole('combobox').all()) {
      const geometry = await select.evaluate((element) => ({
        height: element.getBoundingClientRect().height, width: element.getBoundingClientRect().width,
        parentWidth: element.parentElement?.getBoundingClientRect().width ?? 0,
        containment: getComputedStyle(element).contain,
      }));
      expect(geometry.height).toBeGreaterThanOrEqual(44);
      expect(geometry.width).toBeLessThanOrEqual(geometry.parentWidth + 1);
      expect(geometry.containment).toContain('layout');
    }
    await page.getByLabel('Event skins pot amount').fill('100.01');
    await page.getByRole('button', { name: 'Save purse', exact: true }).click();
    await expect(page.getByText(/Purse settings saved\./)).toBeVisible();
    const pool = page.getByText('Fictional Event Skins · calculated', { exact: true });
    await pool.click();
    await expect(page.getByText(/Unallocated: USD\s+0.02/)).toBeVisible();
    await expect(page.getByRole('table')).toContainText(/USD\s+99.99/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    await page.getByRole('button', { name: 'Public read-only', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Fictional Open · Event-wide skins' })).toBeVisible();
    await expect(page.getByRole('checkbox')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Save event skins settings' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Refresh event skins' }).click();
    await expect(page.getByRole('list', { name: 'Event skins standings' })).toContainText('Fictional golfer 1');
    await page.screenshot({ path: testInfo.outputPath('event-skins-readonly.png'), fullPage: true });
  } finally { await server.close(); }
});
