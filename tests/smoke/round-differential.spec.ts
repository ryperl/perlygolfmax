import { expect, test } from './test';
import { renderComponentFixture } from './render-fixture';
import { strokeGameFixture, strokeGamesRound } from '../../src/domain/stroke-games.test-support';
import { calculateRoundDifferentials } from '../../src/domain/round-differential';
import { isRoundScores } from '../../src/contracts/scoring';
import { contrastRatio } from './contrast';
import { createServer } from 'vite';

const source = strokeGameFixture(18, 8);
const snapshot = { ...source.snapshot, teeProfile: { ...source.snapshot.teeProfile,
  ratings: source.snapshot.teeProfile.ratings.map((rating) => rating.type === 'Total'
    ? { ...rating, course: 72, slope: 130 } : rating) } };
const cards = source.cards.map((card, index) => ({ ...card, holes: card.holes.map((hole) => ({
  ...hole, score: index === 0 ? { kind: 'strokes' as const, strokes: hole.number <= 16 ? 5 : 4 }
    : index === 2 && hole.number === 18 ? { kind: 'picked-up' as const, reportedStrokes: 7 }
      : index >= 3 && hole.number === 18 ? { kind: 'unplayed' as const } : hole.score,
})) }));
const round = { ...strokeGamesRound({ ...source, snapshot, cards }),
  roundDifferentials: calculateRoundDifferentials(snapshot, cards), teeStrokeAllocation: true };

test('compact column info reveals only names without reflow and supports touch and keyboard dismissal', async ({ page }, testInfo) => {
  const server = await createServer({ configFile: false, cacheDir: testInfo.outputPath('help-vite-cache'),
    server: { host: '127.0.0.1', port: 0, hmr: false }, esbuild: { jsx: 'automatic' },
    optimizeDeps: { noDiscovery: true, include: ['react', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime'] },
    logLevel: 'error' });
  try {
    await server.listen();
    const address = server.httpServer?.address();
    if (!address || typeof address === 'string') throw new Error('Fictional differential help server unavailable.');
    const origin = `http://127.0.0.1:${String(address.port)}`;
    await page.route(`${origin}/__help`, (route) => route.fulfill({ contentType: 'text/html',
      body: '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="differential-help-fixture"></div><script type="module" src="/tests/smoke/differential-help-fixture.tsx"></script></body></html>' }));
    await page.goto(`${origin}/__help`);
    const summary = page.getByRole('region', { name: 'Round differentials', exact: true });
    await expect(summary).toBeVisible();
    for (const theme of ['light', 'dark']) {
      await page.evaluate((value) => {
        document.documentElement.dataset.theme = value;
        document.documentElement.style.fontSize = '125%';
      }, theme);
      for (const width of [320, 390, 1280]) {
        await page.setViewportSize({ width, height: 900 });
        const table = summary.getByRole('table');
        const before = await table.boundingBox();
        if (!before) throw new Error('Missing differential table.');
        for (const name of ['Adjusted Gross', 'Estimated Differential']) {
          const trigger = summary.getByRole('button', { name: `About ${name}`, exact: true });
          const target = await trigger.boundingBox();
          expect(target?.height).toBeGreaterThanOrEqual(44);
          expect(target?.width).toBeGreaterThanOrEqual(44);
          await trigger.click();
          const popup = summary.getByRole('dialog', { name, exact: true });
          await expect(popup).toHaveText(name);
          const close = popup.getByRole('button', { name: `Close ${name}`, exact: true });
          await expect(close).toBeFocused();
          const bounds = await popup.boundingBox();
          if (!bounds) throw new Error('Missing column-name popup.');
          expect(bounds.x).toBeGreaterThanOrEqual(0);
          expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
          expect((await close.boundingBox())?.height).toBeGreaterThanOrEqual(44);
          expect(await table.boundingBox()).toEqual(before);
          await close.click();
          await expect(trigger).toBeFocused();
          await trigger.press('Enter');
          await expect(popup).toBeVisible();
          await page.keyboard.press('Escape');
          await expect(popup).not.toBeVisible();
          await expect(trigger).toBeFocused();
          await trigger.click();
          await page.getByRole('button', { name: 'Outside the summary', exact: true }).click();
          await expect(popup).not.toBeVisible();
        }
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      }
    }
  } finally { await server.close(); }
});

for (const theme of ['light', 'dark']) {
  test(`saved 18-hole differential estimates show the entire field and personal card in ${theme}`, async ({ page }, testInfo) => {
    expect(isRoundScores(round)).toBe(true);
    await page.goto('/#events?choose=1');
    await expect(page.getByRole('heading', { name: 'Events', exact: true })).toBeVisible();
    const styles = await page.locator('link[rel="stylesheet"]').evaluateAll((elements) =>
      elements.map((element) => element.getAttribute('href')).filter((href): href is string => href !== null));
    const group = await renderComponentFixture('/src/features/scoring/SavedScorecards.tsx', 'SavedScorecards', {
      round, groupNumber: 1, busy: false, onGroupChange: () => undefined, onEnterScores: () => undefined,
    });
    const individual = await renderComponentFixture('/src/features/scoring/PlayerScorecardRecap.tsx', 'PlayerScorecardRecap', {
      round, card: cards[0], gameId: null,
    });
    await page.setContent(`<html data-theme="${theme}"><head>${styles.map((href) => `<link rel="stylesheet" href="${href}">`).join('')}</head>
      <body><div class="app"><main>${group}<section aria-label="Individual example">${individual}</section></main></div></body></html>`);
    await page.evaluate(() => { document.documentElement.style.fontSize = '125%'; });
    await page.setViewportSize({ width: 320, height: 900 });
    const disclosure = page.locator('.round-scorecards > .scorecard-differential-disclosure');
    await expect(disclosure).toHaveJSProperty('open', false);
    const compact = await disclosure.boundingBox();
    if (!compact) throw new Error('Missing optional differential control.');
    expect(compact.height).toBeGreaterThanOrEqual(44);
    expect(compact.height).toBeLessThanOrEqual(60);
    const card = page.getByRole('region', { name: 'Round scorecards', exact: true })
      .getByRole('table', { name: 'Front nine scorecard', exact: true });
    const initialCard = await card.boundingBox();
    if (!initialCard) throw new Error('Missing primary scorecard.');
    const initialCardTop = initialCard.y + await page.evaluate(() => scrollY);
    const toggle = disclosure.locator('summary');
    await toggle.focus();
    await toggle.press('Enter');
    await expect(disclosure).toHaveJSProperty('open', true);
    const summary = page.getByRole('region', { name: 'Round differentials', exact: true });
    await expect(summary).toBeVisible();
    await toggle.click();
    await expect(summary).not.toBeVisible();
    const restoredCard = await card.boundingBox();
    if (!restoredCard) throw new Error('Missing restored scorecard.');
    expect(restoredCard.y + await page.evaluate(() => scrollY)).toBeCloseTo(initialCardTop, 1);
    await toggle.click();
    const table = summary.getByRole('table', { name: 'Round differentials', exact: true });
    await expect(table.getByRole('row')).toHaveCount(9);
    await expect(table.getByRole('row', { name: /Fictional golfer 1/ })).toContainText('13.9');
    await expect(table.getByRole('row', { name: /Fictional golfer 2/ })).toContainText('0.0');
    for (const number of [3, 8]) {
      await expect(table.getByRole('row', { name: new RegExp(`Fictional golfer ${String(number)}`) })
        .getByLabel('Estimated differential unavailable', { exact: true })).toHaveText('—');
    }
    await expect(table).not.toContainText(/Pending|Unavailable|numeric hole scores|Pickup or DNF/);
    await expect(summary).toContainText('PCC assumed 0');
    await expect(summary).toContainText('Not official');
    const player = page.getByRole('group', { name: 'Estimated round differential', exact: true });
    await expect(player).not.toBeVisible();
    await page.locator('.player-scorecard-recap > .scorecard-differential-disclosure > summary').click();
    await expect(player).toBeVisible();
    await expect(player).toContainText('13.9');
    await expect(player).toContainText('Adjusted gross 88');
    for (const width of [320, 390, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(await table.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
      for (const [label, wide, compact] of [['Adjusted gross', 'Adj. Gross', 'A.G'], ['Estimated differential', 'Est. Diff.', 'E.D']] as const) {
        const header = table.getByRole('columnheader', { name: label, exact: true });
        await expect(header.locator(width === 1280 ? '.differential-heading-wide' : '.differential-heading-compact'))
          .toBeVisible();
        await expect(header.locator(width === 1280 ? '.differential-heading-wide' : '.differential-heading-compact'))
          .toHaveText(width === 1280 ? wide : compact);
      }
      if (width === 390) expect((await summary.boundingBox())?.height).toBeLessThanOrEqual(800);
      for (const cell of await table.getByRole('columnheader').all()) {
        expect(await cell.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
      }
      const colors = await summary.evaluate((element) => ({
        ink: getComputedStyle(element).color, background: getComputedStyle(element).backgroundColor,
      }));
      expect(contrastRatio(colors.ink, colors.background)).toBeGreaterThanOrEqual(4.5);
      if (testInfo.project.name === 'desktop-chromium' && width !== 320) {
        await summary.screenshot({ path: `coverage/round-differentials-${theme}-${width === 390 ? 'phone' : 'desktop'}.png` });
      }
    }
  });
}
