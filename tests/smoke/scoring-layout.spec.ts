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
    playerId: id(number), displayName: `Fictional golfer ${String(number)}`, etag: `fictional-card-${String(number)}`, updatedAt: '2026-01-01T00:00:00Z',
    holes: layout.map((hole) => ({ number: hole.number, score: { kind: 'strokes', strokes: 3 + (hole.number + number) % 4 } })),
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

test('traditional round and individual scorecards fit narrow and wide layouts', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto('/#events');
  await expect(page.getByRole('heading', { level: 1, name: 'Events', exact: true })).toBeVisible();
  const stylesheets = await page.locator('link[rel="stylesheet"]').evaluateAll((links) =>
    links.map((link) => link.getAttribute('href')).filter((href): href is string => href !== null));
  const noop = () => undefined;
  const group = await renderComponentFixture('/src/features/scoring/SavedScorecards.tsx', 'SavedScorecards', {
    round, groupNumber: 1, busy: false, onGroupChange: noop, onEnterScores: noop,
  });
  const recap = await renderComponentFixture('/src/features/scoring/PlayerScorecardRecap.tsx', 'PlayerScorecardRecap', { round, card });
  await page.setContent(`<html><head>${stylesheets.map((href) => `<link rel="stylesheet" href="${href}">`).join('')}</head>
    <body><div class="app"><main><section class="owner-scores"><h1>Fictional round</h1>${group}<div aria-label="Individual example">${recap}</div></section></main></div></body></html>`);
  await page.evaluate(() => { document.documentElement.style.fontSize = '125%'; });
  const roundCard = page.getByRole('region', { name: 'Round scorecards', exact: true });
  const individual = page.getByRole('region', { name: 'Fictional golfer full scorecard', exact: true });
  await expect(individual.getByText('Incomplete', { exact: true })).toBeVisible();
  await expect(individual.locator('.recap-total strong')).toHaveText('11');
  await expect(roundCard.getByLabel('Hole 2: X7', { exact: true })).toBeVisible();
  const front = roundCard.getByRole('region', { name: 'Front nine scorecard', exact: true });
  await front.focus();
  await expect(front).toBeFocused();
  await expect(front.getByRole('columnheader', { name: 'Out' })).toBeVisible();
  const back = roundCard.getByRole('region', { name: 'Back nine scorecard', exact: true });
  await expect(back).toBeVisible();
  await expect(back.getByRole('columnheader', { name: 'Total' })).toBeVisible();
  await expect(front.getByRole('table').getByRole('row')).toHaveCount(8);
  expect(await front.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
  const player = front.getByRole('button', { name: 'Open scorecard for Fictional golfer', exact: true });
  const before = await player.boundingBox();
  await front.evaluate((element) => { element.scrollLeft = 160; });
  const after = await player.boundingBox();
  expect(before).not.toBeNull();
  expect(after).not.toBeNull();
  expect(Math.abs((after?.x ?? 0) - (before?.x ?? 0))).toBeLessThan(2);
  await player.focus();
  await expect(player).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await front.evaluate((element) => { element.scrollLeft = 0; });
  await player.blur();
  if (testInfo.project.name === 'desktop-chromium') {
    await roundCard.screenshot({ path: '.azure/golfer-scorecard-mobile.png' });
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(roundCard.getByRole('heading', { name: 'Round scorecard' })).toBeVisible();
  if (testInfo.project.name === 'desktop-chromium') {
    await roundCard.screenshot({ path: '.azure/golfer-scorecard-desktop.png' });
  }
});
