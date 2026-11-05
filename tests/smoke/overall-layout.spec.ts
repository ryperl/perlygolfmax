import { expect, test } from './test';
import { createServer } from 'vite';
import { isEventLeaderboardView } from '../../src/contracts/event-leaderboard';
import { overallView } from './overall-fixture-data';

test('real optional setup and eight-round overall board fit 320/390px and enlarged text with accessible horizontal scrolling', async ({ page }, testInfo) => {
  expect(isEventLeaderboardView(overallView)).toBe(true);
  const server = await createServer({
    configFile: false, cacheDir: testInfo.outputPath('vite-cache'),
    server: { host: '127.0.0.1', port: 0, hmr: false }, esbuild: { jsx: 'automatic' },
    optimizeDeps: { noDiscovery: true, include: ['react', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime'] },
    logLevel: 'error',
  });
  try {
    await server.listen();
    const address = server.httpServer?.address();
    if (!address || typeof address === 'string') throw new Error('Fictional overall fixture did not start.');
    const origin = `http://127.0.0.1:${String(address.port)}`;
    await page.route(`${origin}/__overall-*`, (route) => {
      const setup = route.request().url().endsWith('setup');
      return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <script>document.documentElement.setAttribute('data-theme', 'light');</script></head><body>
        <div id="${setup ? 'setup' : 'overall'}-fixture"></div>
        <script type="module" src="/tests/smoke/${setup ? 'setup' : 'overall'}-fixture.tsx"></script></body></html>` });
    });
    const errors: string[] = [];
    page.on('pageerror', (error) => { errors.push(error.message); });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${origin}/__overall-setup`);
    const enable = page.getByRole('checkbox', { name: 'Enable overall leaderboard' });
    await expect(enable).not.toBeChecked();
    await enable.check();
    const credit = page.getByRole('combobox', { name: 'Event points credit' });
    await expect(credit).toHaveValue('individual');
    await credit.selectOption('team');
    const roundGame = page.getByRole('combobox', { name: 'Round 1: Fictional round 1 game' });
    await expect(roundGame).toBeEnabled();
    await expect(roundGame).toHaveValue('');
    await roundGame.selectOption({ label: 'Fictional modified gross' });
    await page.getByRole('button', { name: 'Save event workspace' }).click();
    await expect(page.getByText(/^Matches saved setup\./)).toBeVisible();
    await expect(roundGame).toHaveValue('00000000-0000-4000-8000-000000000701');
    await page.getByRole('button', { name: 'Add Round' }).click();
    await expect(page.getByText(/Save this new round/)).toBeVisible();
    await page.getByRole('combobox', { name: 'Competition', exact: true }).selectOption('stroke-play');
    await page.getByRole('combobox', { name: 'Stroke basis' }).selectOption('net');
    await expect(page.getByRole('spinbutton', { name: 'Net handicap allowance (%)' })).toHaveValue('95');
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 844 });
      await page.evaluate(() => { document.documentElement.style.fontSize = '125%'; });
      expect(await page.evaluate(() => window.innerWidth)).toBe(width);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }
    await enable.uncheck();
    await expect(page.getByRole('combobox', { name: 'Competition', exact: true })).toHaveCount(0);
    await page.goto(`${origin}/__overall-board`);
    const board = page.getByRole('region', { name: /Overall results, scroll horizontally/ });
    const table = page.getByRole('table');
    await expect(table.getByRole('columnheader')).toHaveCount(11);
    await expect(table.getByRole('rowheader')).toHaveCount(4);
    await expect(table.getByText('T1', { exact: true })).toHaveCount(2);
    await expect(table.getByText('NR', { exact: true })).toHaveCount(2);
    await expect(table.getByText('NR', { exact: true }).first()).toBeVisible();
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 844 });
      await page.evaluate(() => { document.documentElement.style.fontSize = '125%'; });
      expect(await page.evaluate(() => window.innerWidth)).toBe(width);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      expect(await board.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
      await board.focus();
      await expect(board).toBeFocused();
      await board.evaluate((element) => { element.scrollLeft = 0; });
      const first = table.getByRole('rowheader').first();
      const before = await first.boundingBox();
      await page.keyboard.press('ArrowRight');
      await expect.poll(() => board.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
      const after = await first.boundingBox();
      expect(Math.abs((after?.x ?? 0) - (before?.x ?? 0))).toBeLessThan(2);
      await board.evaluate((element) => { element.scrollLeft = element.scrollWidth; });
      await expect(table.getByRole('columnheader', { name: 'Cumulative result' })).toBeInViewport();
    }
    await page.evaluate(() => { document.documentElement.setAttribute('data-theme', 'dark'); });
    await expect(board).toBeVisible();
    expect(errors).toEqual([]);
  } finally { await server.close(); }
});
