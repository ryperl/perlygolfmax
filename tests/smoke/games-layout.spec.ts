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
  await page.setContent(`<html><head>${stylesheets.map((href) => `<link rel="stylesheet" href="${href}">`).join('')}</head>
    <body><div class="app"><main><section class="owner-scores">${panel}<section class="round-games">${settings}</section></section></main></div></body></html>`);
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
