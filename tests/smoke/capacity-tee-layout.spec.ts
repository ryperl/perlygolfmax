import { expect, test } from './test';
import { createServer } from 'vite';

test('real large controls and mixed-tee cards retain choices at 390/320 and enlarged text', async ({ page }, testInfo) => {
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
    await page.route(`${origin}/__capacity-fixture`, (route) => route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="capacity-tee-fixture"></div><script type="module" src="/tests/smoke/capacity-tee-fixture.tsx"></script></body></html>',
    }));
    const errors: string[] = [];
    page.on('pageerror', (error) => { errors.push(error.message); });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${origin}/__capacity-fixture`);
    await expect(page.getByRole('heading', { name: 'Fictional large event and personal tees' })).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Fictional golfer 01 — round 1 tee', exact: true })).toBeEnabled();
    await expect(page.getByText('Saved player roster (40 selected)', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Next selected players' }).click();
    await expect(page.getByLabel('Fictional golfer 13 — HI Unknown', { exact: true })).toBeChecked();
    await page.getByRole('button', { name: 'Next round golfers' }).click();
    await expect(page.getByRole('combobox', { name: 'Fictional golfer 13 — round 1 group', exact: true })).toHaveValue('4');
    await page.getByLabel('Find round golfers', { exact: true }).fill('40');
    await expect(page.getByRole('combobox', { name: 'Fictional golfer 40 — round 1 group', exact: true })).toHaveValue('10');
    await page.getByLabel('Find round golfers', { exact: true }).fill('01');
    await expect(page.getByRole('combobox', { name: 'Fictional golfer 01 — round 1 tee', exact: true })).toHaveValue('990');
    await page.getByRole('combobox', { name: 'Team 1 member 1', exact: true }).selectOption({ label: 'Fictional golfer 01' });
    await page.getByRole('button', { name: 'Next teams' }).click();
    await page.getByRole('combobox', { name: 'Team 7 member 1', exact: true }).selectOption({ label: 'Fictional golfer 40' });
    await page.getByRole('button', { name: 'Previous teams' }).click();
    await expect(page.getByRole('combobox', { name: 'Team 1 member 1', exact: true })).toHaveValue('00000000-0000-4000-8000-000000000001');
    const cards = page.getByRole('region', { name: 'Round scorecards', exact: true });
    await expect(cards.getByText(/Personal tees shown per golfer/)).toBeVisible();
    await expect(cards.getByLabel('Hole 1: 4, birdie', { exact: true })).toHaveCount(1);
    await cards.getByRole('button', { name: 'Open scorecard for Fictional golfer 01', exact: true }).first().click();
    await expect(page.getByText(/Fictional Silver \/ Fictional personal category · Course rating 80 · Slope 130/)).toBeVisible();
    await page.getByRole('button', { name: 'Back to group scorecard', exact: true }).click();
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await page.evaluate(() => { document.documentElement.style.fontSize = '125%'; });
      expect(await page.evaluate(() => window.innerWidth)).toBe(width);
      expect(await page.evaluate(() => document.documentElement.clientWidth)).toBeGreaterThan(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      for (const region of await cards.locator('.recap-scroll').all()) {
        expect(await region.evaluate((element) => element.clientWidth)).toBeGreaterThan(0);
        expect(await region.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
        const box = await region.boundingBox();
        if (!box) throw new Error('Missing shared scorecard scroll container.');
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(width);
      }
    }
    await page.getByRole('button', { name: 'Enter scores', exact: true }).click();
    const entry = page.getByRole('region', { name: 'Group hole entry', exact: true });
    await expect(entry.getByText(/Fictional Silver.*personal tee · Par 5/)).toBeVisible();
    await expect(entry.getByText(/Golfer tee details shown below/)).toBeVisible();
    await entry.getByRole('textbox', { name: 'Fictional golfer 01 score', exact: true }).clear();
    await entry.getByRole('button', { name: 'Increase score for Fictional golfer 01', exact: true }).click();
    await expect(entry.getByRole('textbox', { name: 'Fictional golfer 01 score', exact: true })).toHaveValue('5');
    await expect(entry.locator('.score-save-status')).toHaveText('Unsaved changes');
    await expect(page.getByText('Auto-check paused for local edits.', { exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('mixed-tee-large-controls.png'), fullPage: true });
    expect(errors).toEqual([]);
  } finally {
    await server.close();
  }
});
