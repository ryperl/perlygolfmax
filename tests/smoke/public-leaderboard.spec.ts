import { createServer } from 'vite';
import { expect, test } from './test';
import { publicLeaderboardFixture } from '../../src/domain/public-leaderboard.test-support';
import { publicLeaderboardSummary } from '../../src/domain/public-leaderboard';

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
      if (kind !== 'overall' && kind !== 'event-skins') throw new Error('Unexpected public result purpose');
      reads.push(kind);
      const summary = publicLeaderboardSummary(full, kind);
      expect(JSON.stringify(summary)).not.toMatch(/roundScores|teeProfile|cards|handicap|netStrokes|contenderIds/);
      await route.fulfill({ json: summary });
    });
    await page.setViewportSize({ width: 320, height: 844 });
    await page.goto(`${origin}/#leaderboard?event=${full.workspace.event.id}`);
    await expect(page.getByRole('table')).toBeVisible();
    await expect(page.getByRole('row', { name: /Fictional golfer 1 /, exact: false })).toContainText('270 strokes');
    expect(reads).toEqual(['overall']);
    await page.evaluate((eventId) => { window.location.hash = `#event-skins?event=${eventId}`; }, full.workspace.event.id);
    await expect(page.getByRole('heading', { name: /Event-wide skins/ })).toBeVisible();
    await expect(page.getByRole('list', { name: 'Event skins standings' })).toContainText('90 skins');
    expect(reads).toEqual(['overall', 'event-skins']);
    await expect(page.getByRole('checkbox')).toHaveCount(0);
    await page.getByText('Hole outcomes and tie reasons', { exact: true }).click();
    await expect(page.getByText(/Fictional Round 1 · Hole 1: awarded/)).toBeVisible();
    await page.getByRole('button', { name: 'Refresh event skins' }).click();
    await expect(page.getByRole('list', { name: 'Event skins standings' })).toBeVisible();
    expect(reads).toEqual(['overall', 'event-skins', 'event-skins']);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await server.close();
  }
});
