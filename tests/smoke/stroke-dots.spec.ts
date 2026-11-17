import { expect, test } from './test';
import { renderComponentFixture } from './render-fixture';
import { strokeGameFixture, strokeGamesRound } from '../../src/domain/stroke-games.test-support';
import { contrastRatio } from './contrast';

const source = strokeGameFixture(18);
const indexes = ['9', '20', '+2', '0'];
const first = source.cards[0];
if (!first) throw new Error('Missing fictional stroke-dot golfer');
const snapshot = {
  ...source.snapshot,
  players: source.snapshot.players.map((player, index) => ({
    ...player, handicapIndex: { ...player.handicapIndex, value: indexes[index] ?? '0' },
  })),
  playerTees: [{ playerId: first.playerId, profile: { ...source.snapshot.teeProfile, id: 301, name: 'Fictional personal tee',
    holes: source.snapshot.teeProfile.holes.map((hole) => ({ ...hole, allocation: 19 - hole.number })) } }],
};
const cards = source.cards.map((card, index) => ({ ...card, holes: card.holes.map((hole) => ({
  ...hole, score: { kind: 'strokes' as const, strokes: hole.number === 1 ? 3 + index
    : index === 1 && hole.number === 2 ? 5 : index === 1 && hole.number === 3 ? 6
      : index === 1 && hole.number === 4 ? 2 : index === 0 && hole.number === 10 ? 3 : 4 },
})) }));
const round = { ...strokeGamesRound({ ...source, snapshot, cards }), teeStrokeAllocation: true };

for (const theme of ['light', 'dark']) {
  test(`tee handicap dots fit score marks and counting badges in ${theme}`, async ({ page }) => {
    await page.goto('/#events?choose=1');
    await expect(page.getByRole('heading', { level: 1, name: 'Events', exact: true })).toBeVisible();
    const styles = await page.locator('link[rel="stylesheet"]').evaluateAll((elements) =>
      elements.map((element) => element.getAttribute('href')).filter((value): value is string => value !== null));
    const group = await renderComponentFixture('/src/features/scoring/SavedScorecards.tsx', 'SavedScorecards', {
      round, groupNumber: 1, busy: false, onGroupChange: () => undefined, onEnterScores: () => undefined,
    });
    const individual = await renderComponentFixture('/src/features/scoring/PlayerScorecardRecap.tsx', 'PlayerScorecardRecap', {
      round, card: cards[0], gameId: null,
    });
    const boundedCard = cards[1];
    if (!boundedCard) throw new Error('Missing fictional bounded-count golfer.');
    const bounded = await renderComponentFixture('/src/features/scoring/ScorecardNine.tsx', 'ScorecardNine', {
      label: 'Bounded count example', subtotal: 'Out', layout: round.layout.slice(0, 9), fullLayout: round.layout,
      cards: [boundedCard], courseHandicaps: [{ playerId: boundedCard.playerId, courseHandicap: 72 }],
      teeStrokeAllocation: true,
    });
    await page.setContent(`<html data-theme="${theme}"><head>${styles.map((href) => `<link rel="stylesheet" href="${href}">`).join('')}</head>
      <body><div class="app"><main data-round-tone="sage">${group}<section aria-label="Individual example">${individual}</section>
      <section aria-label="Bounded count example">${bounded}</section></main></div></body></html>`);
    await page.evaluate(() => { document.documentElement.style.fontSize = '125%'; });
    const groupCard = page.getByRole('region', { name: 'Round scorecards', exact: true });
    const front = groupCard.getByRole('region', { name: 'Front nine scorecard', exact: true });
    const back = groupCard.getByRole('region', { name: 'Back nine scorecard', exact: true });
    const second = front.locator('.recap-score-row').nth(1);
    const cell = second.getByRole('cell').first();
    const dots = cell.getByRole('img', { name: 'Hole 1: 2 handicap strokes received (tee Course Handicap)', exact: true });
    await expect(dots.locator('.score-stroke-dot')).toHaveCount(2);
    await expect(cell.getByLabel('Fictional team 1: counting net ball', { exact: true })).toHaveText('N');
    await expect(front.locator('.recap-score-row').first().getByRole('img')).toHaveCount(0);
    await expect(back.locator('.recap-score-row').first().getByRole('img')).toHaveCount(9);
    await expect(groupCard.locator('.recap-team-row .score-stroke-dots')).toHaveCount(0);
    await expect(groupCard.locator('.recap-score-row').nth(2).getByRole('img')).toHaveCount(0);
    await expect(groupCard.locator('.recap-score-row').nth(3).getByRole('img')).toHaveCount(0);
    const personal = page.getByRole('region', { name: 'Fictional golfer 1 full scorecard', exact: true });
    await expect(personal.getByRole('img')).toHaveCount(9);
    await expect(page.getByRole('region', { name: 'Bounded count example', exact: true })
      .getByRole('img', { name: 'Hole 3: 4 handicap strokes received (tee Course Handicap)', exact: true })).toContainText('x4');
    await expect(back.locator('.recap-score-row').first().getByLabel('Hole 10: 3, birdie', { exact: true })).toHaveClass(/score-birdie/);
    for (const width of [320, 390, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await front.evaluate((element) => { element.scrollLeft = 0; });
      const marker = await dots.boundingBox(), score = await cell.locator('.score-mark').boundingBox();
      const frame = await cell.boundingBox(), badge = await cell.locator('.recap-counting-marker').boundingBox();
      if (!marker || !score || !frame || !badge) throw new Error('Missing stroke-dot layout');
      expect(marker.y).toBeGreaterThanOrEqual(frame.y);
      expect(marker.y + marker.height).toBeLessThanOrEqual(score.y + score.height / 4);
      expect(marker.x + marker.width <= badge.x || badge.x + badge.width <= marker.x
        || marker.y + marker.height <= badge.y || badge.y + badge.height <= marker.y).toBe(true);
      expect(marker.x + marker.width).toBeLessThanOrEqual(frame.x + frame.width);
      const positions = await page.locator('.scorecard-hole-score:has(.score-stroke-dots)').evaluateAll((elements) => elements.map((element) => {
        const score = element.querySelector<HTMLElement>('.score-mark');
        const marker = element.querySelector<HTMLElement>('.score-stroke-dots');
        const cell = element.closest('td');
        if (!score || !marker || !cell) throw new Error('Missing marked score geometry.');
        const ink = getComputedStyle(score), scoreBox = score.getBoundingClientRect(), markerBox = marker.getBoundingClientRect();
        const outline = ink.outlineStyle === 'none' ? 0 : parseFloat(ink.outlineWidth) + parseFloat(ink.outlineOffset);
        return { label: score.getAttribute('aria-label'), classes: score.className,
          markerBottom: markerBox.bottom, paintedTop: scoreBox.top - outline,
          markerTop: markerBox.top, cellTop: cell.getBoundingClientRect().top };
      }));
      for (const kind of ['score-birdie', 'score-eagle', 'score-bogey', 'score-double']) {
        expect(positions.some((position) => position.classes.includes(kind)), `${kind} with stroke dots`).toBe(true);
      }
      for (const position of positions) {
        expect(position.markerTop, position.label ?? '').toBeGreaterThanOrEqual(position.cellTop);
        if (/score-(?:birdie|eagle|bogey|double)/.test(position.classes)) {
          expect(position.markerBottom + 2, position.label ?? '').toBeLessThanOrEqual(position.paintedTop);
        }
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    const colors = await dots.locator('.score-stroke-dot').first().evaluate((element) => {
      const layers: string[] = [];
      let parent = element.parentElement;
      while (parent) { layers.push(getComputedStyle(parent).backgroundColor); parent = parent.parentElement; }
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 1;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Missing color-compositing context');
      for (const layer of layers.reverse()) { context.fillStyle = layer; context.fillRect(0, 0, 1, 1); }
      const pixel = context.getImageData(0, 0, 1, 1).data;
      if (pixel[3] !== 255) throw new Error('Scorecard background did not resolve to opaque');
      return { ink: getComputedStyle(element).backgroundColor, background: `rgb(${String(pixel[0])}, ${String(pixel[1])}, ${String(pixel[2])})` };
    });
    expect(contrastRatio(colors.ink, colors.background)).toBeGreaterThanOrEqual(3);
    if (!process.env.CI) {
      await front.screenshot({ path: `coverage/scorecard-stroke-dots-mixed-${theme}.png` });
      const indexes = [9, 1, 2, 10, 11, 12, 13, 14, 15, 3, 4, 5, 6, 7, 8, 16, 17, 18];
      const exampleLayout = round.layout.map((hole, index) => ({ ...hole, allocation: indexes[index] ?? hole.allocation }));
      const example = await renderComponentFixture('/src/features/scoring/ScorecardNine.tsx', 'ScorecardNine', {
        label: 'Fictional front nine', subtotal: 'Out', layout: exampleLayout.slice(0, 9), fullLayout: exampleLayout,
        cards, courseHandicaps: round.courseHandicaps, teeStrokeAllocation: true,
      });
      await page.setContent(`<html data-theme="${theme}"><head>${styles.map((href) => `<link rel="stylesheet" href="${href}">`).join('')}</head>
        <body><div class="app"><main>${example}</main></div></body></html>`);
      await page.evaluate(() => { document.documentElement.style.fontSize = '125%'; });
      const card = page.locator('.recap-score-row').first();
      await expect(card.getByRole('img', { name: /^Hole 1: 1 handicap stroke/ })).toBeVisible();
      await expect(card.getByRole('img', { name: /^Hole 4:/ })).toHaveCount(0);
      await expect(page.locator('.recap-score-row').nth(1).getByRole('img', { name: /^Hole 2: 2 handicap strokes/ })).toBeVisible();
      await page.locator('.recap-nine').screenshot({ path: `coverage/scorecard-stroke-dots-${theme}.png` });
    }
  });
}
