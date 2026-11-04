import { expect, test } from '@playwright/test';
import type { RoundScores, Scorecard } from '../../src/domain/scoring';
import { renderComponentFixture } from './render-fixture';

const id = (number: number) => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const layout = Array.from({ length: 18 }, (_, index) => ({
  number: index + 1, sourceId: 301 + index, length: 350, par: 4, allocation: index + 1,
}));
const card: Scorecard = {
  playerId: id(1), displayName: 'Fictional golfer', etag: 'card-v1', updatedAt: '2026-01-01T00:00:00Z',
  holes: layout.map((hole) => ({
    number: hole.number,
    score: hole.number === 1 ? { kind: 'strokes', strokes: 4 }
      : hole.number === 2 ? { kind: 'picked-up' } : hole.number === 3 ? { kind: 'did-not-finish' } : { kind: 'unplayed' },
  })),
};
const round: RoundScores = {
  eventId: id(100), eventName: 'Fictional Open', eventStatus: 'active', roundId: id(200), roundName: 'Fictional Round',
  courseName: 'Fictional Course', teeName: 'Fictional Teal', teeCategory: 'Fictional rating', layout,
  groups: [{ number: 1, playerIds: [1, 2, 3, 4].map(id) }],
  cards: [card, ...[2, 3, 4].map((number): Scorecard => ({
    playerId: id(number), displayName: `Fictional golfer ${String(number)}`, etag: null, updatedAt: null,
    holes: layout.map((hole) => ({ number: hole.number, score: { kind: 'unplayed' } })),
  }))],
  setupLocked: true, lastUpdatedAt: card.updatedAt,
};

test('saved source layout and incomplete summary fit narrow owner simulation view', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto('/#events');
  await expect(page.getByRole('heading', { level: 1, name: 'Events', exact: true })).toBeVisible();
  const stylesheets = await page.locator('link[rel="stylesheet"]').evaluateAll((links) =>
    links.map((link) => link.getAttribute('href')).filter((href): href is string => href !== null));
  const source = await renderComponentFixture('/src/features/scoring/ScorecardSummary.tsx', 'SavedScoreLayout', { round });
  const summary = await renderComponentFixture('/src/features/scoring/ScorecardSummary.tsx', 'ScorecardSummary', { card });
  await page.setContent(`<html><head>${stylesheets.map((href) => `<link rel="stylesheet" href="${href}">`).join('')}</head>
    <body><div class="app"><main><section class="owner-scores"><h1>Fictional owner simulation</h1>${summary}${source}</section></main></div></body></html>`);
  await page.evaluate(() => { document.documentElement.style.fontSize = '125%'; });
  await expect(page.getByText('Incomplete — no final gross total.', { exact: false })).toBeVisible();
  await expect(page.getByText('Saved numeric strokes: 4 across 1/18 holes.', { exact: false })).toBeVisible();
  const region = page.getByRole('region', { name: 'Saved source layout, horizontally scrollable' });
  await region.focus();
  await expect(region).toBeFocused();
  await expect(region.getByRole('table', { name: 'Saved source layout' }).getByRole('row')).toHaveCount(19);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
