import { expect, test } from './test';
import { createServer } from 'vite';

test('shared starts and explicit SO remain accessible, compact and distinct from full CH', async ({ page }, testInfo) => {
  const server = await createServer({
    configFile: false, cacheDir: testInfo.outputPath('vite-cache'),
    server: { host: '127.0.0.1', port: 0, hmr: false }, esbuild: { jsx: 'automatic' },
    optimizeDeps: { noDiscovery: true, include: ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime'] },
    logLevel: 'error',
  });
  try {
    await server.listen();
    const address = server.httpServer?.address();
    if (!address || typeof address === 'string') throw new Error('Fictional game handicap server did not start.');
    const origin = `http://127.0.0.1:${String(address.port)}`;
    await page.route(`${origin}/__game-handicaps`, (route) => route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="game-handicaps-fixture"></div><script type="module" src="/tests/smoke/game-handicaps-fixture.tsx"></script></body></html>',
    }));
    await page.setViewportSize({ width: 320, height: 844 });
    await page.goto(`${origin}/__game-handicaps`);
    await expect(page.getByRole('heading', { name: 'Round scorecard', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Games', exact: true }).click();
    await page.getByRole('button', { name: 'Add game', exact: true }).click();
    const editor = page.getByRole('form', { name: 'Game settings' });
    await expect(editor.getByRole('region', { name: 'Shared starting holes' })).toContainText('Group 1 starts at hole 10.');
    await editor.getByRole('combobox', { name: 'Score basis', exact: true }).selectOption('net');
    const rule = editor.getByRole('combobox', { name: 'Net handicap rule', exact: true });
    await expect(rule).toHaveValue('full-course-v1');
    expect(await rule.evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
    await rule.selectOption('group-low-v1');
    await rule.focus();
    await expect(rule).toBeFocused();
    await expect(editor.getByLabel('Handicap allowance (%)')).toHaveCount(0);
    await expect(editor).toContainText('SO = full captured CH minus the lowest CH');
    await editor.getByRole('button', { name: 'Save game', exact: true }).click();
    await expect(page.getByText('Game settings saved.', { exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Stableford results', exact: true })).toContainText('SO off lowest in saved group');
    await page.getByRole('button', { name: 'Enter scores', exact: true }).click();
    const expectations = ['CH 11, SO 8', 'CH 4, SO 1', 'CH 8, SO 5', 'CH 3, SO 0'];
    for (const [index, label] of expectations.entries()) {
      await expect(page.getByRole('article', { name: `Fictional golfer ${String(index + 1)} scorecard`, exact: true })
        .getByRole('heading')).toContainText(label);
    }
    await page.getByRole('button', { name: 'Games', exact: true }).click();
    await page.getByRole('button', { name: 'Edit Stableford', exact: true }).click();
    await editor.getByRole('combobox', { name: 'Net handicap rule', exact: true }).selectOption('full-course-v1');
    await expect(editor.getByLabel('Handicap allowance (%)')).toHaveValue('95');
    await editor.getByRole('button', { name: 'Save game', exact: true }).click();
    await expect(page.getByText('Game settings saved.', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Enter scores', exact: true }).click();
    await expect(page.getByLabel('Strokes off the low player: 8', { exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  } finally {
    await server.close();
  }
});
