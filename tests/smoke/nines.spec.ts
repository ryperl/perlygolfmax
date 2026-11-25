import { expect, test } from './test';
import { createServer } from 'vite';

test('Nines can be set up, scored, ranked and settled beside another group on a narrow phone screen', async ({ page }, testInfo) => {
  const server = await createServer({
    configFile: false, cacheDir: testInfo.outputPath('vite-cache'),
    server: { host: '127.0.0.1', port: 0, hmr: false }, esbuild: { jsx: 'automatic' },
    optimizeDeps: { noDiscovery: true, include: ['react', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime'] },
    logLevel: 'error',
  });
  try {
    await server.listen();
    const address = server.httpServer?.address();
    if (!address || typeof address === 'string') throw new Error('Fictional Nines server did not start.');
    const origin = `http://127.0.0.1:${String(address.port)}`;
    await page.route(`${origin}/__nines`, (route) => route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head>
        <body><div id="nines-fixture"></div><script type="module" src="/tests/smoke/nines-fixture.tsx"></script></body></html>`,
    }));
    await page.setViewportSize({ width: 320, height: 844 });
    await page.goto(`${origin}/__nines`);
    await page.evaluate(() => { document.documentElement.style.fontSize = '125%'; });

    // Set up: Nines, net with strokes off the low golfer, $0.25 a point.
    await page.getByRole('button', { name: 'Add game', exact: true }).click();
    const editor = page.getByRole('form', { name: 'Game settings' });
    await editor.getByLabel('Game type').selectOption('nines');
    const setup = editor.getByRole('region', { name: 'Nines setup' });
    // Only the threesome (group 2) can play Nines; the foursome is not offered.
    await expect(setup.getByLabel('Playing group of three')).toHaveValue('2');
    await expect(setup.getByRole('option')).toHaveText(['Choose a saved group of three', 'Group 2']);
    await editor.getByLabel('Score basis').selectOption('net');
    await editor.getByLabel('Net handicap rule').selectOption('group-low-v1');
    await setup.getByLabel('Stake per point (USD)').fill('.25');
    for (const control of await editor.getByRole('combobox').all()) {
      expect(await control.evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
    }
    await editor.getByRole('button', { name: 'Save game', exact: true }).click();
    await expect(page.getByText('Game settings saved.', { exact: true })).toBeVisible();

    // Results: golfer 5 wins 17 holes but picks up on hole 5 (worst): 86 / 56 / 20 points. Only the threesome is listed.
    await page.getByText('Nines · Game standings', { exact: true }).click();
    const results = page.getByRole('region', { name: 'Nines results', exact: true });
    await expect(results).toContainText('5 / 3 / 1 points per hole');
    const rows = results.getByRole('table').locator('tbody tr');
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toContainText('86');
    await expect(rows.nth(1)).toContainText('56');
    await expect(rows.nth(2)).toContainText('20');

    // Money in points, not dots: (3 x 86 - 162) x $0.25 = $24.00 due.
    const settlement = page.getByRole('region', { name: /internal settlement/ });
    await expect(settlement).toContainText('86 points');
    await expect(settlement).toContainText('Due USD 24.00');
    await expect(settlement).toContainText('Owes USD 25.50');
    await expect(settlement).not.toContainText('dots');
    await expect(settlement.getByRole('region', { name: 'Combined earned points and planned money' })).toBeVisible();

    // Leaderboard ranks by points, highest first.
    const board = page.getByRole('region', { name: 'Round leaderboard', exact: true });
    await expect(board.getByRole('list', { name: 'Standings', exact: true }).getByRole('listitem')).toHaveCount(3);
    await expect(board.getByRole('list', { name: 'Standings', exact: true }).getByRole('listitem').first()).toContainText('86');

    // Nothing spills sideways on a 320px phone.
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  } finally {
    await server.close();
  }
});
