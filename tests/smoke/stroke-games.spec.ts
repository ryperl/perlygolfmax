import { expect, test } from './test';
import { createServer } from 'vite';
import { strokeGameId } from '../../src/domain/stroke-games.test-support';

test('Ball Drop and Skins saved results, carry resolution and dedicated editing work on narrow screens', async ({ page }, testInfo) => {
  const server = await createServer({
    configFile: false, cacheDir: testInfo.outputPath('vite-cache'),
    server: { host: '127.0.0.1', port: 0, hmr: false }, esbuild: { jsx: 'automatic' },
    optimizeDeps: { noDiscovery: true, include: ['react', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime'] },
    logLevel: 'error',
  });
  try {
    await server.listen();
    const address = server.httpServer?.address();
    if (!address || typeof address === 'string') throw new Error('Fictional stroke game server did not start.');
    const origin = `http://127.0.0.1:${String(address.port)}`;
    await page.route(`${origin}/__stroke-games`, (route) => route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head>
        <body><div id="stroke-games-fixture"></div><script type="module" src="/tests/smoke/stroke-games-fixture.tsx"></script></body></html>`,
    }));
    await page.setViewportSize({ width: 320, height: 844 });
    await page.goto(`${origin}/__stroke-games`);
    await page.evaluate(() => { document.documentElement.style.fontSize = '125%'; });
    const ball = page.getByRole('region', { name: 'Fictional Ball Drop results', exact: true });
    const skins = page.getByRole('region', { name: 'Fictional Skins results', exact: true });
    await expect(ball.getByRole('table')).toContainText('Strokes to par');
    await expect(ball.getByRole('table')).toContainText('-1');
    await expect(skins).toContainText('15 unawarded · 0 pending');
    await expect(skins.getByRole('table').locator('tbody tr').first()).toContainText('3');
    const board = page.getByRole('region', { name: 'Round leaderboard', exact: true });
    await board.getByLabel('Leaderboard game').selectOption(strokeGameId(701));
    expect(await board.getByLabel('Leaderboard game').evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
    await expect(board.getByLabel('3 skins', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Earlier saved hole pending', exact: true }).click();
    await expect(skins).toContainText('0 unawarded · 18 pending');
    await expect(board.getByText('No ranked scores yet.', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Resolve earlier saved hole', exact: true }).click();
    await expect(board.getByLabel('3 skins', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Edit Fictional Skins', exact: true }).click();
    const editor = page.getByRole('form', { name: 'Game settings' });
    await expect(editor.getByLabel('Carry tied skins forward')).toBeChecked();
    await expect(editor.getByLabel('Handicap allowance (%)')).toHaveCount(0);
    await expect(editor.getByLabel('Points preset')).toHaveCount(0);
    for (const select of await editor.getByRole('combobox').all()) {
      expect(await select.evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
    }
    await editor.getByLabel('Carry tied skins forward').uncheck();
    await editor.getByRole('button', { name: 'Save game', exact: true }).click();
    await expect(page.getByText('Game settings saved.', { exact: true })).toBeVisible();
    await expect(board.getByLabel('1 skins', { exact: true })).toBeVisible();
    await expect(skins).toContainText('17 unawarded · 0 pending');
    await page.getByRole('button', { name: 'Edit Fictional Ball Drop', exact: true }).click();
    await editor.getByLabel('Game format').selectOption('ball-drop-two-gross');
    await expect(editor.getByLabel('Team 1 member 1')).toHaveValue(strokeGameId(1));
    await editor.getByLabel('Game format').selectOption('ball-drop-two-net');
    await expect(editor.getByLabel('Team 1 member 1')).toHaveValue(strokeGameId(1));
    await editor.getByLabel('Game format').selectOption('ball-drop-net-gross');
    for (const select of await editor.getByRole('combobox').all()) {
      expect(await select.evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
    }
    await editor.getByRole('button', { name: 'Save game', exact: true }).click();
    await expect(page.getByText('Game settings saved.', { exact: true })).toBeVisible();
    const scorecards = page.getByRole('region', { name: 'Round scorecards', exact: true });
    await expect(scorecards.getByRole('row', { name: 'Fictional golfer 1 · Fictional Ball Drop to par', exact: true }).first()).toContainText('-1');
    await scorecards.getByRole('combobox', { name: 'Game', exact: true }).selectOption(strokeGameId(701));
    expect(await scorecards.getByRole('combobox', { name: 'Game', exact: true }).evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
    await expect(scorecards.getByRole('row', { name: 'Fictional golfer 2 · Fictional Skins skins', exact: true }).first()).toContainText('0');
    await ball.getByRole('button', { name: 'Back 9', exact: true }).click();
    await expect(ball.getByRole('columnheader', { name: '18', exact: true })).toBeVisible();
    const scroll = ball.getByRole('region', { name: 'Fictional Ball Drop to par scorecard', exact: true });
    await scroll.focus();
    await expect(scroll).toBeFocused();
    for (const select of [board.getByLabel('Leaderboard game'), scorecards.getByRole('combobox', { name: 'Game', exact: true })]) {
      expect(await select.evaluate((element) => {
        const label = element.closest('label');
        return label !== null && label.scrollWidth <= label.clientWidth;
      })).toBe(true);
    }
    expect(await scroll.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
    expect(await scorecards.getByRole('region', { name: 'Front nine scorecard', exact: true })
      .evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const button = await ball.getByRole('button', { name: 'Front 9', exact: true }).boundingBox();
    expect(button?.height).toBeGreaterThanOrEqual(44);
    await page.getByRole('button', { name: 'Edit Fictional Skins', exact: true }).click();
    await page.getByRole('button', { name: 'Toggle public results', exact: true }).click();
    await expect(editor).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Add game', exact: true })).toHaveCount(0);
    await expect(skins.getByRole('table')).toBeVisible();
  } finally {
    await server.close();
  }
});
