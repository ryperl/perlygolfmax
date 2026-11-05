import { expect, test } from './test';
import { createServer } from 'vite';

test('fictional invitation controls fit 320/390, enlarged text, keyboard focus and the complete searchable roster', async ({ page }, testInfo) => {
  const server = await createServer({
    configFile: false, cacheDir: testInfo.outputPath('vite-cache'),
    server: { host: '127.0.0.1', port: 0, hmr: false }, esbuild: { jsx: 'automatic' },
    optimizeDeps: { noDiscovery: true, include: ['react', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime'] },
    logLevel: 'error',
  });
  try {
    await server.listen();
    const address = server.httpServer?.address();
    if (!address || typeof address === 'string') throw new Error('Fictional admission server did not start.');
    const origin = `http://127.0.0.1:${String(address.port)}`;
    await page.route(`${origin}/__admission-fixture`, (route) => route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="admission-fixture"></div><script type="module" src="/tests/smoke/admission-fixture.tsx"></script></body></html>',
    }));
    const errors: string[] = [];
    page.on('pageerror', (error) => { errors.push(error.message); });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${origin}/__admission-fixture`);
    const owner = page.getByRole('region', { name: 'Player access', exact: true });
    const join = page.getByRole('region', { name: 'Join event', exact: true });
    await expect(owner.getByRole('combobox', { name: 'Saved roster golfer', exact: true })).toBeVisible();
    await owner.getByRole('button', { name: 'Next golfers', exact: true }).click();
    await expect(owner.getByRole('combobox', { name: 'Saved roster golfer', exact: true }).locator('option').filter({ hasText: 'Fictional golfer 21' })).toHaveCount(1);
    await owner.getByLabel('Find saved roster golfer').fill('125');
    await owner.getByRole('combobox', { name: 'Saved roster golfer', exact: true }).selectOption({ label: 'Fictional golfer 125' });
    await owner.getByRole('button', { name: 'Create private invitation link', exact: true }).click();
    const link = owner.getByLabel('Private share link');
    await expect(link).toHaveAttribute('type', 'password');
    await expect(link).toHaveValue(/#join\?event=/);
    await link.focus();
    await expect(link).toBeFocused();
    expect(await link.evaluate((element) => getComputedStyle(element).outlineStyle)).not.toBe('none');
    await page.keyboard.press('Tab');
    await expect(owner.getByRole('button', { name: 'Copy private invitation link' })).toBeFocused();
    await expect(join.getByRole('button', { name: 'Request access' })).toBeEnabled();
    await join.getByRole('button', { name: 'Request access' }).click();
    await expect(join.getByText('ABCD-1234', { exact: true })).toBeVisible();
    await owner.getByLabel('Verification code from Fictional golfer 1').fill('ABCD-1234');
    await owner.getByRole('checkbox').check();
    await owner.getByRole('button', { name: 'Approve Fictional golfer 1', exact: true }).click();
    await expect(owner.getByText('Player admission approved.', { exact: true })).toBeVisible();
    await join.getByRole('button', { name: 'Check approval', exact: true }).click();
    await expect(join.getByRole('link', { name: 'Open event overview' })).toBeVisible();
    expect(await page.locator('body').innerText()).not.toContain('A'.repeat(43));
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await page.evaluate(() => { document.documentElement.style.fontSize = '125%'; });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      for (const control of await page.locator('.admission-panel input, .admission-panel button, .admission-panel select, .admission-panel a').all()) {
        const box = await control.boundingBox();
        if (!box) continue;
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(width);
      }
    }
    expect(errors).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath('fictional-admission-mobile.png'), fullPage: true });
  } finally { await server.close(); }
});
