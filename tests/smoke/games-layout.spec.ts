import { expect, test } from '@playwright/test';
import type { RoundGameDefinition } from '../../src/domain/games';
import type { RoundScores } from '../../src/domain/scoring';
import type { RoundSnapshot } from '../../src/domain/setup';
import { calculateGameResults, stablefordPoints } from '../../src/domain/stableford';
import { renderComponentFixture } from './render-fixture';

const id = (number: number) => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const layout = Array.from({ length: 18 }, (_, index) => ({ number: index + 1, sourceId: 300 + index, length: 350, par: 4, allocation: index + 1 }));
const indices = ['18.9', '0', '+2.1'];
const snapshot: RoundSnapshot = {
  id: id(70), name: 'Fictional games round', courseId: 'ghin:301:302', courseVersionId: 'a'.repeat(64),
  course: {
    provider: 'usga-ghin', sourceId: 302, name: 'Fictional Dunes', status: 'Active', number: null, city: 'Fictional City', state: 'Fictional State',
    facility: { id: 301, name: 'Fictional Club', status: 'Active', number: null, golfAssociationId: 303, address: 'Fictional address', longitude: 0, latitude: 0 },
    season: { name: 'All year', start: '01/01', end: '12/31', allYear: true },
  },
  teeProfile: {
    id: 901, name: 'Fictional Gold', category: 'Fictional category', holeCount: 18, totalYardage: 6300, totalMeters: 5760,
    totalPar: 72, strokeAllocation: true, shorter: false, eligibleSides: 'All', holes: layout,
    ratings: [{ type: 'Total', course: 72, slope: 113, bogey: 90 }, { type: 'Front', course: 36, slope: 113, bogey: 45 }, { type: 'Back', course: 36, slope: 113, bogey: 45 }],
  },
  players: Array.from({ length: 4 }, (_, index) => {
    const value = indices[index];
    return { playerId: id(index + 1), displayName: `Fictional golfer ${String(index + 1)}`,
      handicapIndex: value === undefined ? null : {
        id: id(500 + index), value, effectiveDate: '2026-01-01', source: 'Fictional capture',
        recordedAt: '2026-01-01T00:00:00Z', recordedBy: { tenantId: id(200), objectId: id(201) }, previousObservationId: null,
      } };
  }),
  groups: [{ number: 1, playerIds: [1, 2, 3, 4].map(id) }], scoringStarted: true,
};
const definitions: readonly RoundGameDefinition[] = [
  { id: id(700), name: 'Fictional standard net', preset: 'standard', basis: 'net', handicapAllowancePercent: 95, points: stablefordPoints('standard') },
  { id: id(701), name: 'Fictional modified gross', preset: 'modified', basis: 'gross', handicapAllowancePercent: 95, points: stablefordPoints('modified') },
];
const cards: RoundScores['cards'] = snapshot.players.map((player) => ({
  playerId: player.playerId, displayName: player.displayName, etag: 'card-v1', updatedAt: '2026-01-01T00:00:00Z',
  holes: layout.map((hole) => ({ number: hole.number, score: { kind: 'strokes', strokes: 4 } })),
}));
const round: RoundScores = {
  eventId: id(50), eventName: 'Fictional event', eventStatus: 'active', roundId: snapshot.id, roundName: snapshot.name,
  courseName: snapshot.course.name, teeName: snapshot.teeProfile.name, teeCategory: snapshot.teeProfile.category, layout, cards,
  groups: snapshot.groups, setupLocked: true, lastUpdatedAt: '2026-01-01T00:00:00Z',
  games: { configuration: { eventId: id(50), roundId: snapshot.id, etag: 'games-v1', games: definitions }, results: calculateGameResults(definitions, snapshot, cards) },
};

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
  await expect(net.getByRole('cell', { name: 'No captured Handicap Index is available.', exact: true })).toBeVisible();
  await expect(net.getByRole('cell', { name: '+2', exact: true })).toBeVisible();
  await expect(page.getByLabel('Handicap allowance (%)')).toHaveValue('95');
  const editor = page.getByRole('region', { name: 'Editable points table', exact: true });
  await editor.focus();
  await expect(editor).toBeFocused();
  await expect(page.getByRole('rowheader', { name: 'Albatross · 3 under', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.setViewportSize({ width: 1280, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('expanded hole-point disclosures scroll independently without widening the page', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#events');
  await expect(page.getByRole('heading', { name: 'Events', exact: true })).toBeVisible();
  const stylesheets = await page.locator('link[rel="stylesheet"]').evaluateAll((links) =>
    links.map((link) => link.getAttribute('href')).filter((href): href is string => href !== null));
  const panel = await renderComponentFixture('/src/features/games/RoundGamesPanel.tsx', 'RoundGamesPanel', {
    round, busy: false, onDirtyChange: () => undefined,
    onSave: () => Promise.resolve(null), onRefresh: () => Promise.resolve(round),
  });
  await page.setContent(`<html><head><meta name="viewport" content="width=device-width, initial-scale=1">${stylesheets.map((href) => `<link rel="stylesheet" href="${href}">`).join('')}</head>
    <body><div class="app"><main><section class="owner-scores"><div>${panel}</div></section></main></div></body></html>`);
  const game = page.getByRole('region', { name: 'Fictional modified gross results', exact: true });
  const firstDetails = game.locator('details').nth(0);
  const secondDetails = game.locator('details').nth(1);
  await firstDetails.locator('summary').click();
  await secondDetails.locator('summary').click();
  const first = game.getByRole('region', { name: 'Fictional modified gross, Fictional golfer 1, hole points', exact: true });
  const second = game.getByRole('region', { name: 'Fictional modified gross, Fictional golfer 2, hole points', exact: true });
  for (const [width, fontSize] of [[390, '100%'], [320, '125%']] as const) {
    await page.setViewportSize({ width, height: 844 });
    await page.evaluate((size) => { document.documentElement.style.fontSize = size; }, fontSize);
    expect(await page.evaluate(() => window.innerWidth)).toBe(width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(await first.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
    await first.focus();
    await expect(first).toBeFocused();
    await first.evaluate((element) => { element.scrollLeft = 0; });
    await first.hover();
    await page.mouse.wheel(300, 0);
    await expect.poll(() => first.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
    expect(await second.evaluate((element) => element.scrollLeft)).toBe(0);
    await first.evaluate((element) => { element.scrollLeft = element.scrollWidth - element.clientWidth; });
    const regionBox = await first.boundingBox();
    const lastHoleBox = await first.getByRole('columnheader', { name: '18', exact: true }).boundingBox();
    if (!regionBox || !lastHoleBox) throw new Error('Missing expanded hole-point table bounds.');
    expect(lastHoleBox.x).toBeGreaterThanOrEqual(regionBox.x);
    expect(lastHoleBox.x + lastHoleBox.width).toBeLessThanOrEqual(regionBox.x + regionBox.width + 1);
    expect(await page.evaluate(() => window.scrollX)).toBe(0);
    await first.evaluate((element) => { element.scrollLeft = 0; });
    const firstHoleBox = await first.getByRole('columnheader', { name: '1', exact: true }).boundingBox();
    if (!firstHoleBox) throw new Error('Missing first hole bounds.');
    expect(firstHoleBox.x).toBeGreaterThanOrEqual(regionBox.x);
    expect(firstHoleBox.x + firstHoleBox.width).toBeLessThanOrEqual(regionBox.x + regionBox.width + 1);
    await second.evaluate((element) => { element.scrollLeft = element.scrollWidth - element.clientWidth; });
    expect(await first.evaluate((element) => element.scrollLeft)).toBe(0);
    expect(await second.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
    await second.evaluate((element) => { element.scrollLeft = 0; });
  }
  await firstDetails.locator('summary').click();
  await expect(first).not.toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await firstDetails.locator('summary').click();
  await expect(first).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate(() => { document.documentElement.style.fontSize = '100%'; });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
