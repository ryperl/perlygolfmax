import { expect, test } from './test';
import { createServer } from 'vite';

test('purse controls retain forty-golfer choices at 390/320 and enlarged text with keyboard-accessible shared scroll', async ({ page }, testInfo) => {
  const server = await createServer({
    configFile: false, cacheDir: testInfo.outputPath('vite-cache'),
    server: { host: '127.0.0.1', port: 0, hmr: false }, esbuild: { jsx: 'automatic' },
    optimizeDeps: { noDiscovery: true, include: ['react', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime'] },
    logLevel: 'error',
  });
  try {
    await server.listen();
    const address = server.httpServer?.address();
    if (!address || typeof address === 'string') throw new Error('Fictional purse server did not start.');
    const origin = `http://127.0.0.1:${String(address.port)}`;
    await page.route(`${origin}/__purse-fixture`, (route) => route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="purse-fixture"></div><script type="module" src="/tests/smoke/purse-fixture.tsx"></script></body></html>',
    }));
    const errors: string[] = [];
    page.on('pageerror', (error) => { errors.push(error.message); });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${origin}/__purse-fixture`);
    await expect(page.getByRole('heading', { name: 'Fictional purse layout fixture' })).toBeVisible();
    await page.getByRole('button', { name: 'Edit purse', exact: true }).click();
    await expect(page.getByRole('combobox', { name: 'Currency', exact: true })).toBeEnabled();
    await expect(page.getByRole('checkbox', { name: 'Fictional golfer 1', exact: true })).toBeChecked();
    await page.getByRole('button', { name: 'Next recipients', exact: true }).click();
    await expect(page.getByRole('checkbox', { name: 'Fictional golfer 13', exact: true })).toBeChecked();
    await page.getByRole('checkbox', { name: 'Fictional golfer 14', exact: true }).check();
    await page.getByLabel('Find recipients for Fictional side pot', { exact: true }).fill('40');
    await expect(page.getByRole('checkbox', { name: 'Fictional golfer 40', exact: true })).toBeChecked();
    await page.getByLabel('Find recipients for Fictional side pot', { exact: true }).fill('1');
    await expect(page.getByRole('checkbox', { name: 'Fictional golfer 1', exact: true })).toBeChecked();
    await page.getByRole('button', { name: 'Add award pool', exact: true }).click();
    await page.getByLabel('Pool 3 name', { exact: true }).fill('Fictional new team award');
    const teamOption = await page.getByRole('combobox', { name: 'Pool 3 source', exact: true }).locator('option').filter({ hasText: 'team awards' }).getAttribute('value');
    if (!teamOption) throw new Error('Missing fictional saved team source.');
    await page.getByRole('combobox', { name: 'Pool 3 source', exact: true }).selectOption(teamOption);
    await expect(page.getByRole('combobox', { name: 'Pool 3 award amount unit', exact: true })).toHaveValue('per-team');
    await page.getByRole('button', { name: 'Add place prize to pool 3', exact: true }).click();
    await page.getByLabel('Pool 3 prize 1 place', { exact: true }).fill('1');
    await page.getByLabel('Pool 3 prize 1 amount', { exact: true }).fill('1.01');
    await page.getByLabel('Pool 3 prize 2 place', { exact: true }).fill('2');
    await page.getByLabel('Pool 3 prize 2 amount', { exact: true }).fill('0.01');
    const preview = page.getByRole('region', { name: 'Unsaved purse projection', exact: true });
    await preview.getByRole('button', { name: 'Next winnings golfers', exact: true }).click();
    await expect(preview.getByRole('row', { name: /Fictional golfer 13 / })).toBeVisible();
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await page.evaluate(() => { document.documentElement.style.fontSize = '125%'; });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      for (const scroll of await page.getByRole('region', { name: 'Individual winnings table', exact: true }).all()) {
        const box = await scroll.boundingBox();
        if (!box) throw new Error('Missing purse shared scroll region.');
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(width);
        expect(await scroll.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
        await scroll.focus();
        await expect(scroll).toBeFocused();
        await page.keyboard.press('ArrowRight');
        await expect.poll(() => scroll.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
      }
    }
    const currency = page.getByRole('combobox', { name: 'Currency', exact: true });
    await currency.focus();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('combobox', { name: 'Planned funding', exact: true })).toBeFocused();
    await expect(page.getByText('4 recipients selected: Fictional golfer 1, Fictional golfer 13, Fictional golfer 40, Fictional golfer 14')).toBeVisible();
    await page.getByRole('button', { name: 'Save purse', exact: true }).click();
    await expect(page.getByText(/Purse settings saved/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Edit purse', exact: true })).toBeEnabled();
    expect(errors).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath('fictional-purse-mobile.png'), fullPage: true });
  } finally {
    await server.close();
  }
});
