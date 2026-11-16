import { createServer } from 'vite';
import { expect, test } from './test';
import { publicLeaderboardFixture } from '../../src/domain/public-leaderboard.test-support';
import { publicLeaderboardSummary } from '../../src/domain/public-leaderboard';
import { calculateEventSkinsDetails } from '../../src/domain/event-skins';
import { compactSkinsDetails, compactSkinsSummary } from '../../src/contracts/compact-event-skins';
import { contrastRatio } from './contrast';

test('public overall and skins each load only one purpose-specific response without raw scorecard pages', async ({ page }, testInfo) => {
  const server = await createServer({
    configFile: false, cacheDir: testInfo.outputPath('vite-cache'),
    server: { host: '127.0.0.1', port: 0, hmr: false }, esbuild: { jsx: 'automatic' },
    optimizeDeps: { noDiscovery: true, include: ['react', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime'] },
    logLevel: 'error',
  });
  const full = publicLeaderboardFixture();
  const reads: string[] = [];
  const errors: string[] = [];
  page.on('pageerror', (error) => { errors.push(error.message); });
  try {
    await server.listen();
    const address = server.httpServer?.address();
    if (!address || typeof address === 'string') throw new Error('Public leaderboard fixture server did not start');
    const origin = `http://127.0.0.1:${String(address.port)}`;
    await page.route(`${origin}/`, (route) => route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="public-app-fixture"></div><script type="module" src="/tests/smoke/public-app-fixture.tsx"></script></body></html>',
    }));
    await page.route(`${origin}/__public-api/**`, async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      expect(request.method()).toBe('GET');
      expect(request.headers().authorization).toBeUndefined();
      expect(url.pathname).toBe(`/__public-api/public/events/${full.workspace.event.id}/leaderboard`);
      expect(url.searchParams.has('privatePart')).toBe(false);
      const kind = url.searchParams.get('view');
      if (kind === 'event-skins-details') {
        expect(url.searchParams.get('format')).toBe('compact');
        reads.push(kind);
        const detail = calculateEventSkinsDetails(full.workspace, full.roundScores);
        expect(JSON.stringify(detail)).not.toMatch(/roundScores|teeProfile|cards|handicapIndex|measurementId|recordedBy|etag/);
        const wire = compactSkinsDetails(detail);
        expect(new TextEncoder().encode(JSON.stringify(wire)).length).toBeLessThan(48 * 1024);
        await route.fulfill({ json: wire });
        return;
      }
      if (kind !== 'overall' && kind !== 'event-skins') throw new Error('Unexpected public result purpose');
      reads.push(kind);
      const summary = publicLeaderboardSummary(full, kind);
      expect(JSON.stringify(summary)).not.toMatch(/roundScores|teeProfile|cards|handicap|netStrokes|contenderIds/);
      if (summary.kind === 'event-skins') {
        expect(url.searchParams.get('format')).toBe('compact');
        const wire = compactSkinsSummary(summary);
        expect(new TextEncoder().encode(JSON.stringify(wire)).length).toBeLessThan(8 * 1024);
        await route.fulfill({ json: wire });
      } else await route.fulfill({ json: summary });
    });
    await page.setViewportSize({ width: 320, height: 844 });
    await page.goto(`${origin}/#leaderboard?event=${full.workspace.event.id}`);
    await expect(page.getByRole('table')).toBeVisible();
    await expect(page.getByRole('row', { name: /Fictional golfer 1 /, exact: false })).toContainText('270 strokes');
    expect(reads).toEqual(['overall']);
    await page.evaluate((eventId) => { window.location.hash = `#event-skins?event=${eventId}`; }, full.workspace.event.id);
    await expect(page.getByRole('heading', { name: /Event-wide skins/ })).toBeVisible();
    const back = page.getByRole('link', { name: 'Back to event overview', exact: true });
    await expect(back).toHaveAttribute('href', `#overview?event=${full.workspace.event.id}`);
    await expect(page.getByRole('list', { name: 'Event skins standings' })).toContainText('90 skins');
    expect(reads).toEqual(['overall', 'event-skins']);
    const card = page.getByRole('article', { name: 'Skins for Fictional golfer 1', exact: true });
    const winningHoles = card.locator('.skins-ticket-details > summary');
    await expect(winningHoles).toContainText('View winning holes');
    await winningHoles.focus();
    await page.keyboard.press('Enter');
    await expect(winningHoles).toContainText('Hide winning holes');
    await expect(card.getByRole('list', { name: 'Won holes at Fictional Round 1', exact: true }).getByText('Hole 1', { exact: true })).toBeVisible();
    expect(await winningHoles.locator('.skins-win-count').evaluate((element) => getComputedStyle(element).borderWidth)).toBe('0px');
    expect(await winningHoles.evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(48);
    expect(reads).toEqual(['overall', 'event-skins']);
    for (const theme of ['light', 'dark']) {
      await page.evaluate((value) => { document.documentElement.dataset.theme = value; document.documentElement.style.fontSize = '125%'; }, theme);
      const colors = await card.evaluate((element) => {
        const heading = element.querySelector('h2');
        const summary = element.querySelector('summary');
        const round = element.querySelector('.skins-winning-round');
        if (!heading || !summary || !round) throw new Error('Missing skins ticket contents');
        const control = getComputedStyle(summary); const roundStyle = getComputedStyle(round);
        return { name: getComputedStyle(heading).color, background: getComputedStyle(element).backgroundColor,
          action: control.color, actionBackground: control.backgroundColor, roundText: roundStyle.color, roundBackground: roundStyle.backgroundColor };
      });
      expect(contrastRatio(colors.name, colors.background)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(colors.action, colors.actionBackground)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(colors.roundText, colors.roundBackground)).toBeGreaterThanOrEqual(4.5);
      expect(await card.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    }
    await card.screenshot({ path: testInfo.outputPath('compact-skins-ticket.png') });
    await expect(page.getByRole('checkbox')).toHaveCount(0);
    await page.getByRole('button', { name: 'View skins details', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Skins details', exact: true })).toBeVisible();
    await page.getByText('Hole 1 · Fictional golfer 1', { exact: true }).click();
    await expect(page.getByRole('table', { name: 'Hole 1 skins comparison' })).toBeVisible();
    await expect(back).toBeVisible();
    expect(reads).toEqual(['overall', 'event-skins', 'event-skins-details']);
    await page.getByRole('button', { name: 'Back to skins', exact: true }).click();
    await page.getByRole('button', { name: 'Refresh event skins' }).click();
    await expect(page.getByRole('list', { name: 'Event skins standings' })).toBeVisible();
    expect(reads).toEqual(['overall', 'event-skins', 'event-skins-details', 'event-skins']);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await server.close();
  }
});
