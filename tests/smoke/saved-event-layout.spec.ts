import { expect, test } from './test';
import type { EventWorkspace } from '../../src/domain/setup';
import type { EventEntryProgress } from '../../src/features/event-trip/entry-progress';
import { renderComponentFixture } from './render-fixture';

const id = (number: number) => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const players = Array.from({ length: 8 }, (_, index) => ({ playerId: id(index + 1), displayName: `Fictional golfer ${String(index + 1)}` }));
const workspace: EventWorkspace = {
  event: { id: id(50), name: 'Fictional Coastal Event', role: 'owner', status: 'active', etag: 'fictional-v1', createdAt: '2026-01-01' },
  location: 'Fictional County', roster: players, etag: 'fictional-v1',
  rounds: [1, 2].map((number) => ({
    id: id(70 + number), name: `Fictional round ${String(number)}`, courseId: 'ghin:301:302', courseVersionId: 'a'.repeat(64),
    teeTime: number === 1 ? '08:30' : '13:00',
    course: {
      provider: 'usga-ghin', sourceId: 302, name: 'Fictional Dunes', status: 'Active', number: null, city: 'Fictional City', state: 'Fictional State',
      facility: { id: 301, name: 'Fictional Club', status: 'Active', number: null, golfAssociationId: 303, address: 'Fictional address', longitude: 0, latitude: 0 },
      season: { name: 'All year', start: '01/01', end: '12/31', allYear: true },
    },
    teeProfile: {
      id: 901, name: 'Fictional Gold', category: 'Fictional category', holeCount: 9, totalYardage: 900, totalMeters: 823,
      totalPar: 36, strokeAllocation: true, shorter: false, eligibleSides: 'All',
      ratings: [{ type: 'Total', course: 36, slope: 100, bogey: 45 }, { type: 'Front', course: 36, slope: 100, bogey: 45 }, { type: 'Back', course: 36, slope: 100, bogey: 45 }],
      holes: Array.from({ length: 9 }, (_, index) => ({ number: index + 1, sourceId: 400 + index, length: 100, par: 4, allocation: index + 1 })),
    },
    groups: [{ number: 1, playerIds: players.slice(0, 4).map((player) => player.playerId) }, { number: 2, playerIds: players.slice(4).map((player) => player.playerId) }],
    players, scoringStarted: number === 1,
  })),
};
const progress: EventEntryProgress = Object.fromEntries(workspace.rounds.map((round, index) => [round.id, {
  kind: 'ready',
  summary: {
    status: index === 0 ? 'In progress' : 'No scores yet', entered: index === 0 ? 56 : 0,
    total: 72, completeHoles: index === 0 ? 5 : 0, totalHoles: 9,
    groups: [1, 2].map((number) => ({
      number, status: index !== 0 ? 'No scores yet' : number === 1 ? 'Entries complete' : 'In progress',
      entered: index !== 0 ? 0 : number === 1 ? 36 : 20, total: 36,
      completeHoles: index !== 0 ? 0 : number === 1 ? 9 : 5, totalHoles: 9,
    })),
  },
}]));

for (const view of ['overview', 'rounds', 'group'] as const) {
  test(`saved event ${view} remains readable and event-specific on narrow screens`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 740 });
    await page.goto('/#events');
    await expect(page.getByRole('heading', { name: 'Events', exact: true })).toBeVisible();
    const stylesheets = await page.locator('link[rel="stylesheet"]').evaluateAll((links) =>
      links.map((link) => link.getAttribute('href')).filter((href): href is string => href !== null));
    const html = await renderComponentFixture('/src/features/event-trip/EventTripView.tsx', 'EventTripView', { workspace, view, progress });
    await page.setContent(`<html><head><meta name="viewport" content="width=device-width, initial-scale=1">${stylesheets.map((href) => `<link rel="stylesheet" href="${href}">`).join('')}</head>
      <body><div class="app"><main>${html}</main></div></body></html>`);
    await page.evaluate(() => { document.documentElement.style.fontSize = '125%'; });
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(view === 'overview' ? workspace.event.name : view === 'rounds' ? 'Rounds' : 'The Group');
    await expect(page.getByText('8:30 AM (course local time)', { exact: true })).toBeVisible();
    await expect(page.getByText('1:00 PM (course local time)', { exact: true })).toBeVisible();
    const open = page.getByRole('link', { name: 'Open scorecard for Fictional round 1' });
    await expect(open).toHaveAttribute('href', `#organizer?event=${id(50)}&round=${id(71)}`);
    await open.focus();
    await expect(open).toBeFocused();
    await expect(page.getByText('In progress', { exact: false }).first()).toBeVisible();
    await expect(page.getByText('Entries complete', { exact: false }).first()).toBeVisible();
    await expect(page.getByText('No scores yet', { exact: false }).first()).toBeVisible();
    expect(await page.evaluate(() => window.innerWidth)).toBe(320);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.setViewportSize({ width: 1280, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expect(page.getByRole('link', { name: 'Configure event' })).toHaveAttribute('href', `#organizer?event=${id(50)}`);
  });
}
