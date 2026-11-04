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
      : hole.number === 2 ? { kind: 'picked-up', reportedStrokes: 7 } : hole.number === 3 ? { kind: 'did-not-finish' } : { kind: 'unplayed' },
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

test('one-hole group entry fits a narrow screen with usable touch targets', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto('/#events');
  await expect(page.getByRole('heading', { level: 1, name: 'Events', exact: true })).toBeVisible();
  const stylesheets = await page.locator('link[rel="stylesheet"]').evaluateAll((links) =>
    links.map((link) => link.getAttribute('href')).filter((href): href is string => href !== null));
  const hole = round.layout[0];
  if (!hole) throw new Error('Missing fictional source hole.');
  const noop = () => undefined;
  const entry = await renderComponentFixture('/src/features/scoring/GroupHoleEntry.tsx', 'GroupHoleEntry', {
    groups: round.groups, groupNumber: 1, layout: round.layout, hole,
    rows: round.cards.map((item) => ({
      playerId: item.playerId, displayName: item.displayName, saved: { kind: 'unplayed' }, canReview: false,
    })),
    busy: false, readOnly: false, unsavedCount: 0,
    onGroupChange: noop, onHoleChange: noop, onEdit: noop, onReview: noop, onDiscard: noop, onSave: noop,
  });
  await page.setContent(`<html><head>${stylesheets.map((href) => `<link rel="stylesheet" href="${href}">`).join('')}</head>
    <body><div class="app"><main><section class="owner-scores">${entry}</section></main></div></body></html>`);
  await page.evaluate(() => { document.documentElement.style.fontSize = '125%'; });
  await expect(page.getByRole('heading', { name: 'Hole 1', exact: true })).toBeVisible();
  await expect(page.getByRole('textbox')).toHaveCount(4);
  for (const input of await page.getByRole('textbox').all()) {
    await expect(input).toHaveValue('');
    const box = await input.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
    expect(box?.width).toBeGreaterThanOrEqual(44);
  }
  const save = page.getByRole('button', { name: 'Save & Next Hole', exact: true });
  await save.scrollIntoViewIfNeeded();
  await save.focus();
  await expect(save).toBeFocused();
  expect((await save.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('saved source layout and incomplete summary fit narrow owner simulation view', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto('/#events');
  await expect(page.getByRole('heading', { level: 1, name: 'Events', exact: true })).toBeVisible();
  const stylesheets = await page.locator('link[rel="stylesheet"]').evaluateAll((links) =>
    links.map((link) => link.getAttribute('href')).filter((href): href is string => href !== null));
  const source = await renderComponentFixture('/src/features/scoring/ScorecardSummary.tsx', 'SavedScoreLayout', { round });
  const recap = await renderComponentFixture('/src/features/scoring/PlayerScorecardRecap.tsx', 'PlayerScorecardRecap', { round, card });
  await page.setContent(`<html><head>${stylesheets.map((href) => `<link rel="stylesheet" href="${href}">`).join('')}</head>
    <body><div class="app"><main><section class="owner-scores"><h1>Fictional owner simulation</h1>${recap}${source}</section></main></div></body></html>`);
  await page.evaluate(() => { document.documentElement.style.fontSize = '125%'; });
  await expect(page.getByText('Incomplete — not a final gross result', { exact: true })).toBeVisible();
  await expect(page.locator('.recap-total strong')).toHaveText('11');
  await expect(page.getByRole('cell', { name: 'X7', exact: true })).toBeVisible();
  const front = page.getByRole('region', { name: 'Front nine scorecard for Fictional golfer' });
  await front.focus();
  await expect(front).toBeFocused();
  await expect(front.getByRole('columnheader', { name: 'Out' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Back nine scorecard for Fictional golfer' })).toBeVisible();
  const region = page.getByRole('region', { name: 'Saved source layout, horizontally scrollable' });
  await region.focus();
  await expect(region).toBeFocused();
  await expect(region.getByRole('table', { name: 'Saved source layout' }).getByRole('row')).toHaveCount(19);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
