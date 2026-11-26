import { expect, test } from './test';
import { createServer } from 'vite';

test('Dots can be linked to Nines through the form and settle once with it on a narrow phone screen', async ({ page }, testInfo) => {
  const server = await createServer({
    configFile: false, cacheDir: testInfo.outputPath('vite-cache'),
    server: { host: '127.0.0.1', port: 0, hmr: false }, esbuild: { jsx: 'automatic' },
    optimizeDeps: { noDiscovery: true, include: ['react', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime'] },
    logLevel: 'error',
  });
  try {
    await server.listen();
    const address = server.httpServer?.address();
    if (!address || typeof address === 'string') throw new Error('Fictional Nines + Dots server did not start.');
    const origin = `http://127.0.0.1:${String(address.port)}`;
    await page.route(`${origin}/__nines-linked-dots`, (route) => route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head>
        <body><div id="nines-linked-dots-fixture"></div>
        <script type="module" src="/tests/smoke/nines-linked-dots-fixture.tsx"></script></body></html>`,
    }));
    await page.setViewportSize({ width: 320, height: 844 });
    await page.goto(`${origin}/__nines-linked-dots`);
    await page.evaluate(() => { document.documentElement.style.fontSize = '125%'; });

    // Set up: Dots for the Nines threesome (group 2), linked to the saved Nines game, with Sandy.
    await page.getByRole('button', { name: 'Add game', exact: true }).click();
    const editor = page.getByRole('form', { name: 'Game settings' });
    await editor.getByLabel('Game type').selectOption('dots');
    await editor.getByLabel('Dots playing group').selectOption('2');
    await editor.getByLabel('Dots mode').selectOption('linked');
    await editor.getByLabel('Linked game').selectOption({ label: 'Nines' });
    await expect(editor.getByText('Nines: each golfer plays alone · USD 0.25 per point difference')).toBeVisible();
    await expect(editor.getByLabel('USD per dot difference')).toHaveCount(0);
    // Each golfer plays alone, so Assassin cannot be chosen. The specials list starts open for this Dots version.
    await expect(editor.getByRole('checkbox', { name: /^Assassin/u })).toBeDisabled();
    await editor.getByRole('checkbox', { name: 'Sandy', exact: true }).check();
    for (const control of await editor.getByRole('combobox').all()) {
      expect(await control.evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
    }
    await editor.getByRole('button', { name: 'Save game', exact: true }).click();
    await expect(page.getByText('Game settings saved.', { exact: true })).toBeVisible();

    // One settlement for both games, in points: golfer 6 has 56 Nines points + 1 Sandy = 57.
    // Total 86 + 57 + 20 = 163, so golfer 6 is due (3 x 57 - 163) x $0.25 = $2.00.
    const games = page.getByRole('region', { name: 'Round games', exact: true });
    const settlement = games.getByRole('region', { name: 'Group 2 Nines + Dots internal settlement' });
    await expect(settlement).toContainText('Nines 56 + Dots 1');
    await expect(settlement).toContainText('57 points');
    await expect(settlement).toContainText('Due USD 2.00');
    await expect(settlement).toContainText('Owes USD 25.75');
    await expect(games.getByRole('region', { name: /internal settlement/u })).toHaveCount(1);

    // The leaderboard opens on the combined standings.
    const board = page.getByRole('region', { name: 'Round leaderboard', exact: true });
    await expect(board.getByLabel('Leaderboard game')).toHaveValue(/^combined:/u);
    const combined = board.getByRole('list', { name: 'Combined standings', exact: true }).getByRole('listitem');
    await expect(combined).toHaveCount(3);
    await expect(combined.first()).toContainText('86 points');
    await expect(combined.nth(1)).toContainText('Nines 56 + Dots 1');

    // Nothing spills sideways on a 320px phone.
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  } finally {
    await server.close();
  }
});
