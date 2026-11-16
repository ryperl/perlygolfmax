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
    await expect(page.getByRole('table', { name: 'Hole 1 skins comparison' })).toBeVisible();
    const navigator = page.getByRole('navigation', { name: 'Skins holes', exact: true });
    await expect(navigator.getByRole('button')).toHaveCount(18);
    const firstRoundHighlight = await navigator.locator('[aria-pressed="true"]').evaluate((element) => getComputedStyle(element).backgroundColor);
    const awardColor = await page.locator('.skins-hole-state').evaluate((element) => getComputedStyle(element, '::before').backgroundColor);
    const lastHole = navigator.getByRole('button', { name: /^Hole 18:/ });
    await lastHole.focus(); await page.keyboard.press('Enter');
    await expect(lastHole).toBeFocused();
    await expect(page.getByRole('table', { name: 'Hole 18 skins comparison', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Next hole', exact: true }).click();
    await expect(page.getByRole('table', { name: 'Hole 1 skins comparison', exact: true })).toBeVisible();
    const secondRound = full.workspace.rounds[1];
    if (!secondRound) throw new Error('Missing second fictional round');
    await page.getByRole('combobox', { name: 'Round', exact: true }).selectOption(secondRound.id);
    await navigator.getByRole('button', { name: /^Hole 2:/ }).click();
    expect(await navigator.locator('[aria-pressed="true"]').evaluate((element) => getComputedStyle(element).backgroundColor)).not.toBe(firstRoundHighlight);
    expect(await page.locator('.skins-hole-state').evaluate((element) => getComputedStyle(element, '::before').backgroundColor)).toBe(awardColor);
    const comparison = page.getByRole('table', { name: 'Hole 2 skins comparison', exact: true });
    await expect(comparison).toBeVisible();
    await expect(comparison.getByRole('columnheader')).toHaveText(['Player', 'Par', 'Gross', 'Shots', 'Net']);
    await expect(page.getByRole('table')).toHaveCount(1);
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      for (const theme of ['light', 'dark']) {
        await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
        const selected = navigator.locator('[aria-pressed="true"]');
        const colors = await selected.evaluate((element) => {
          const label = element.querySelector('small');
          if (!label) throw new Error('Missing hole status');
          const style = getComputedStyle(element);
          return { text: style.color, status: getComputedStyle(label).color, background: style.backgroundColor, line: style.borderColor };
        });
        const palette = await page.locator('.event-skins-filters').evaluate((element) => ({
          surface: getComputedStyle(element).backgroundColor, line: getComputedStyle(element).borderInlineStartColor,
        }));
        expect(colors.background).toBe(palette.surface);
        expect(colors.line).toBe(palette.line);
        expect(await page.locator('.skins-hole-panel').evaluate((element) => getComputedStyle(element).borderInlineStartColor)).toBe(palette.line);
        expect(await page.locator('.skins-hole-number').evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(palette.surface);
        expect(contrastRatio(colors.text, colors.background)).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(colors.status, colors.background)).toBeGreaterThanOrEqual(4.5);
        for (const button of await navigator.getByRole('button').all()) {
          const box = await button.boundingBox();
          expect(box?.width).toBeGreaterThanOrEqual(44);
          expect(box?.height).toBeGreaterThanOrEqual(48);
        }
        for (const header of await comparison.getByRole('columnheader').all()) {
          expect(await header.evaluate((element) => getComputedStyle(element).whiteSpace)).toBe('nowrap');
        }
        expect(await comparison.locator('caption').evaluate((element) => getComputedStyle(element).clipPath)).toBe('inset(50%)');
        const layout = await comparison.evaluate((element) => ({ width: element.getBoundingClientRect().width,
          available: element.parentElement?.clientWidth ?? 0,
          columns: Array.from(element.querySelectorAll('thead th'), (cell) => ({
            label: cell.textContent, width: cell.getBoundingClientRect().width, font: getComputedStyle(cell).fontSize,
          })) }));
        expect(layout.width, JSON.stringify(layout)).toBeLessThanOrEqual(layout.available + 1);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      }
    }
    await page.locator('.event-skins-details').screenshot({ path: testInfo.outputPath('skins-hole-navigator.png') });
    await expect(back).toBeVisible();
    expect(reads).toEqual(['overall', 'event-skins', 'event-skins-details']);
    await page.getByRole('button', { name: 'Refresh skins details', exact: true }).click();
    await expect(page.getByRole('table', { name: 'Hole 2 skins comparison', exact: true })).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Round', exact: true })).toHaveValue(secondRound.id);
    expect(reads).toEqual(['overall', 'event-skins', 'event-skins-details', 'event-skins-details']);
    await page.getByRole('button', { name: 'Back to skins', exact: true }).click();
    await page.getByRole('button', { name: 'Refresh event skins' }).click();
    await expect(page.getByRole('list', { name: 'Event skins standings' })).toBeVisible();
    expect(reads).toEqual(['overall', 'event-skins', 'event-skins-details', 'event-skins-details', 'event-skins']);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await server.close();
  }
});
