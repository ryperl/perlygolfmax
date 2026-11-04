import { expect, test } from '@playwright/test';
import { createServer } from 'vite';
import { stablefordPoints } from '../../src/domain/stableford';
import { renderComponentFixture } from './render-fixture';
import { fictionalGamesRound as round } from './games-fixture-data';

const id = (number: number) => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;

test('configured game points appear alongside strokes on group and individual scorecards', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto('/#events');
  await expect(page.getByRole('heading', { name: 'Events', exact: true })).toBeVisible();
  const stylesheets = await page.locator('link[rel="stylesheet"]').evaluateAll((links) =>
    links.map((link) => link.getAttribute('href')).filter((href): href is string => href !== null));
  const noop = () => undefined;
  const group = await renderComponentFixture('/src/features/scoring/SavedScorecards.tsx', 'SavedScorecards', {
    round, groupNumber: 1, busy: false, onGroupChange: noop, onEnterScores: noop,
  });
  const card = round.cards[0];
  if (!card) throw new Error('Missing fictional player.');
  const individual = await renderComponentFixture('/src/features/scoring/PlayerScorecardRecap.tsx', 'PlayerScorecardRecap', { round, card });
  await page.setContent(`<html><head><meta name="viewport" content="width=device-width, initial-scale=1">${stylesheets.map((href) => `<link rel="stylesheet" href="${href}">`).join('')}</head>
    <body><div class="app"><main><section class="owner-scores">${group}${individual}</section></main></div></body></html>`);
  await page.evaluate(() => { document.documentElement.style.fontSize = '125%'; });
  const scorecard = page.getByRole('region', { name: 'Round scorecards', exact: true });
  await expect(scorecard.getByRole('combobox', { name: 'Game', exact: true })).toHaveValue(id(700));
  const back = scorecard.getByRole('region', { name: 'Back nine scorecard', exact: true });
  const points = back.getByRole('row', { name: 'Fictional golfer 1 · Fictional standard net points', exact: true });
  await expect(points.getByRole('cell').last()).toHaveText('54');
  await expect(back.getByLabel('Hole 10: 4, par', { exact: true })).toHaveCount(4);
  await back.focus();
  await expect(back).toBeFocused();
  const player = page.getByRole('region', { name: 'Fictional golfer 1 full scorecard', exact: true });
  await expect(player.getByRole('row', { name: 'Fictional golfer 1 · Fictional standard net points', exact: true })).toHaveCount(2);
  await expect(scorecard.getByText('Fictional golfer 4: No captured Handicap Index is available.', { exact: true })).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.setViewportSize({ width: 1280, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  if (testInfo.project.name === 'desktop-chromium') {
    await scorecard.screenshot({ path: '.azure/scorecard-with-game-points.png' });
  }
});

test('configurable game results and points editor fit narrow and enlarged layouts', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto('/#events');
  await expect(page.getByRole('heading', { name: 'Events', exact: true })).toBeVisible();
  const stylesheets = await page.locator('link[rel="stylesheet"]').evaluateAll((links) =>
    links.map((link) => link.getAttribute('href')).filter((href): href is string => href !== null));
  const noop = () => undefined;
  const panel = await renderComponentFixture('/src/features/games/RoundGamesPanel.tsx', 'RoundGamesPanel', {
    round, busy: false, onDirtyChange: noop, onSave: () => Promise.resolve(null), onRefresh: () => Promise.resolve(round),
  });
  const points = stablefordPoints('modified');
  const settings = await renderComponentFixture('/src/features/games/GameSettings.tsx', 'GameSettings', {
    draft: { id: id(702), name: 'Fictional custom rules', preset: 'modified', basis: 'net', allowance: '95',
      rows: points.rows.map((row) => ({ ...row, points: String(row.points) })), better: '12', worse: '-2' },
    disabled: false, saveDisabled: false, cancelDisabled: false, retry: false, onChange: noop, onSave: noop, onCancel: noop,
  });
  await page.setContent(`<html><head><meta name="viewport" content="width=device-width, initial-scale=1">${stylesheets.map((href) => `<link rel="stylesheet" href="${href}">`).join('')}</head>
    <body><div class="app"><main><section class="owner-scores"><div>${panel}</div><section class="round-games">${settings}</section></section></main></div></body></html>`);
  await page.evaluate(() => { document.documentElement.style.fontSize = '125%'; });
  const net = page.getByRole('region', { name: 'Fictional standard net results', exact: true });
  await expect(net.getByText('54', { exact: true })).toBeVisible();
  await expect(net.getByText('Fictional golfer 4: No captured Handicap Index is available.', { exact: true })).toBeVisible();
  await expect(net.getByText('Playing handicap +2', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Handicap allowance (%)')).toHaveValue('95');
  const editor = page.getByRole('region', { name: 'Editable points table', exact: true });
  await editor.focus();
  await expect(editor).toBeFocused();
  await expect(page.getByRole('rowheader', { name: 'Albatross · 3 under', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.setViewportSize({ width: 1280, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('compact game cards keep golfers visible with shared scrolling and working nine controls', async ({ page }, testInfo) => {
  const server = await createServer({
    configFile: false, cacheDir: testInfo.outputPath('vite-cache'),
    server: { host: '127.0.0.1', port: 0, hmr: false }, esbuild: { jsx: 'automatic' },
    optimizeDeps: { noDiscovery: true, include: ['react', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime'] },
    logLevel: 'error',
  });
  try {
    await server.listen();
    const address = server.httpServer?.address();
    if (!address || typeof address === 'string') throw new Error('Fictional Games server did not start.');
    const origin = `http://127.0.0.1:${String(address.port)}`;
    await page.route(`${origin}/__games-fixture`, (route) => route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">
        <script>(() => {
          const param = new URLSearchParams(window.location.search).get("clawpilotTheme");
          const theme = param || (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
          document.documentElement.setAttribute("data-theme", theme);
        })();</script></head><body><div id="games-fixture"></div>
        <script type="module" src="/tests/smoke/games-fixture.tsx"></script></body></html>`,
    }));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${origin}/__games-fixture`);
    const game = page.getByRole('region', { name: 'Fictional modified gross results', exact: true });
    const card = game.getByRole('region', { name: 'Fictional modified gross points scorecard', exact: true });
    await expect(card).toBeVisible();
    await expect(card.locator('tbody tr')).toHaveCount(4);
    await expect(game.locator('details')).toHaveCount(0);
    const route = page.url();
    for (const [width, fontSize] of [[390, '100%'], [320, '125%']] as const) {
      await page.setViewportSize({ width, height: 844 });
      await page.evaluate((size) => { document.documentElement.style.fontSize = size; }, fontSize);
      expect(await page.evaluate(() => window.innerWidth)).toBe(width);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      expect(await card.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
      await card.focus();
      await expect(card).toBeFocused();
      await card.hover();
      await page.mouse.wheel(250, 0);
      await expect.poll(() => card.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
      const bounds = await card.boundingBox();
      const player = await card.locator('tbody th').first().boundingBox();
      if (!bounds || !player) throw new Error('Missing compact scorecard bounds.');
      expect(Math.abs(player.x - bounds.x)).toBeLessThanOrEqual(1);
      const lastFront = card.getByRole('columnheader', { name: '9', exact: true });
      await lastFront.evaluate((element) => { element.scrollIntoView({ block: 'nearest', inline: 'end' }); });
      const lastBox = await lastFront.boundingBox();
      if (!lastBox) throw new Error('Missing ninth-hole bounds.');
      expect(lastBox.x).toBeGreaterThanOrEqual(player.x + player.width - 1);
      expect(lastBox.x + lastBox.width).toBeLessThanOrEqual(bounds.x + bounds.width + 1);
      await game.getByRole('button', { name: 'Back 9', exact: true }).click();
      await expect(card.getByRole('columnheader', { name: '18', exact: true })).toBeVisible();
      expect(await card.evaluate((element) => element.scrollLeft)).toBe(0);
      await expect(card.locator('tbody tr')).toHaveCount(4);
      expect(page.url()).toBe(route);
      expect(await page.evaluate(() => window.scrollX)).toBe(0);
      await game.getByRole('button', { name: 'Front 9', exact: true }).click();
      await expect(card.getByRole('columnheader', { name: '1', exact: true })).toBeVisible();
    }
    if (testInfo.project.name === 'desktop-chromium') {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.evaluate(() => { document.documentElement.style.fontSize = '100%'; });
      await game.screenshot({ path: '.azure/games-scorecard-after.png' });
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const entry = page.getByRole('region', { name: 'Fictional entry preview', exact: true });
    const first = entry.getByRole('textbox', { name: 'Fictional golfer 1 score', exact: true });
    await expect(first).toHaveValue('');
    await entry.getByRole('button', { name: 'Increase score for Fictional golfer 1', exact: true }).click();
    await expect(first).toHaveValue('4');
    await entry.getByRole('button', { name: 'Increase score for Fictional golfer 1', exact: true }).click();
    await expect(first).toHaveValue('5');
    await entry.getByRole('button', { name: 'Decrease score for Fictional golfer 2', exact: true }).click();
    await expect(entry.getByRole('textbox', { name: 'Fictional golfer 2 score', exact: true })).toHaveValue('4');
    await entry.getByRole('textbox', { name: 'Fictional golfer 3 score', exact: true }).fill('12');
    const fourth = entry.getByRole('textbox', { name: 'Fictional golfer 4 score', exact: true });
    await expect(fourth).toBeFocused();
    await fourth.fill('6');
    await expect(entry.getByRole('button', { name: 'Save & Next Hole', exact: true })).toBeFocused();
    await expect(entry.getByLabel('Fictional save count', { exact: true })).toHaveText('0');
    await entry.getByRole('combobox', { name: 'Jump to hole', exact: true }).selectOption('2');
    await expect(first).toHaveValue('');
    const board = page.getByRole('region', { name: 'Round leaderboard', exact: true });
    await expect(board.getByRole('list', { name: 'Standings' }).getByRole('listitem')).toHaveCount(3);
    await board.getByRole('combobox', { name: 'Leaderboard game' }).selectOption(id(701));
    await expect(board.getByLabel('Tied position 1', { exact: true })).toHaveCount(4);
    await expect(board.getByRole('list', { name: 'Standings' }).getByRole('listitem')).toHaveCount(4);
    await expect(board.getByText('Saved points · All game cards complete. This is not round finalization.', { exact: true })).toBeVisible();
    for (const [width, fontSize] of [[390, '100%'], [320, '125%']] as const) {
      await page.setViewportSize({ width, height: 844 });
      await page.evaluate((size) => { document.documentElement.style.fontSize = size; }, fontSize);
      expect(await page.evaluate(() => window.innerWidth)).toBe(width);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }
    if (testInfo.project.name === 'desktop-chromium') {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.evaluate(() => { document.documentElement.style.fontSize = '100%'; });
      await board.getByRole('combobox', { name: 'Leaderboard game' }).selectOption(id(700));
      await board.screenshot({ path: '.azure/round-leaderboard-mobile.png' });
    }
  } finally {
    await server.close();
  }
});
