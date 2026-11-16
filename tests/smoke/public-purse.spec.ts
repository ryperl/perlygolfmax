import { createServer } from 'vite';
import { expect, test } from './test';
import { fictionalPurse, fictionalPurseSave } from './purse-fixture-data';
import { publicPurseSummary } from '../../src/domain/public-purse';
import { purseTestId } from '../../src/domain/purse.test-support';
import { playerWinningsBreakdown } from '../../src/domain/winnings-breakdown';

test('public purse is compact, course-filtered and refreshed through one minimal read without identity or writes', async ({ page }, testInfo) => {
  const server = await createServer({
    configFile: false, cacheDir: testInfo.outputPath('vite-cache'),
    server: { host: '127.0.0.1', port: 0, hmr: false }, esbuild: { jsx: 'automatic' },
    optimizeDeps: { noDiscovery: true, include: ['react', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime'] },
    logLevel: 'error',
  });
  const initial = fictionalPurse(12);
  const plan = initial.configuration.plan;
  if (!plan) throw new Error('Missing fictional plan');
  const saved = fictionalPurseSave(initial, { ...plan, funding: { kind: 'fixed', budgetMinor: 301 }, pools: [...plan.pools,
    { id: purseTestId(6100), name: 'Fictional bonus', source: { kind: 'manual' }, awardUnit: 'pot', amountMinor: 101, recipientIds: [purseTestId(1)] },
  ] }, [], initial.configuration.etag, purseTestId(8101)).current;
  const base = publicPurseSummary(saved);
  const first = base.pools[0];
  if (!first) throw new Error('Missing fictional pool');
  const secondRound = purseTestId(2001);
  const summary = { ...base,
    reviewNotices: [{ code: 'prize-tie' as const, label: 'Fictional desert prizes', contextId: purseTestId(5001) }],
    rounds: [...base.rounds, { id: secondRound, label: 'Fictional Desert Course' }],
    pools: [...base.pools, { ...first, id: purseTestId(5001), name: 'Fictional desert prizes', roundId: secondRound, status: 'pending' as const },
      { ...first, id: purseTestId(5002), name: 'Fictional overall prizes', roundId: null, status: 'pending' as const }],
  };
  let reads = 0;
  let limited = false;
  let detailReads = 0;
  const errors: string[] = [];
  page.on('pageerror', (error) => { errors.push(error.message); });
  try {
    await server.listen();
    const address = server.httpServer?.address();
    if (!address || typeof address === 'string') throw new Error('Public purse fixture server did not start');
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
      expect(url.pathname).toBe(`/__public-api/public/events/${summary.eventId}/purse`);
      if (url.searchParams.get('view') === 'player') {
        detailReads++;
        const value = playerWinningsBreakdown(saved, url.searchParams.get('playerId') ?? '');
        await route.fulfill({ json: value });
        return;
      }
      expect(url.searchParams.get('view')).toBe('summary');
      reads++;
      await route.fulfill(limited
        ? { status: 429, json: { code: 'REQUEST_LIMIT_EXCEEDED' }, headers: { 'Retry-After': '60' } }
        : { json: summary });
    });
    await page.goto(`${origin}/#purse?event=${summary.eventId}`);
    const picker = page.getByRole('combobox', { name: 'Course', exact: true });
    await expect(picker).toBeVisible();
    const review = page.getByRole('complementary', { name: 'Organizer review needed' });
    await expect(review.getByRole('status')).toContainText('Organizer review needed · 1');
    await review.getByText('Organizer review needed · 1', { exact: true }).click();
    await expect(review.getByText(/Resolve the prize tie/)).toBeVisible();
    await expect(page.getByRole('columnheader')).toHaveText(['Player / pools won', 'Won (USD)']);
    await expect(page.getByRole('rowheader').nth(0)).toContainText('Fictional golfer 1');
    await expect(page.getByRole('rowheader').nth(1)).toContainText('Fictional golfer 5');
    await expect(page.getByRole('rowheader').nth(2)).toContainText('Fictional golfer 9');
    await expect(page.getByRole('row', { name: /Fictional golfer 4 / })).toContainText('0.00');
    await expect(page.getByText(/projected|planned budget|remaining unscheduled/i)).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Edit purse|Save purse/ })).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Course prize pools' }).locator('svg')).not.toHaveCount(0);
    const courses = page.getByRole('region', { name: 'Course prize pools' });
    await picker.selectOption(secondRound);
    await expect(courses.getByText('Fictional desert prizes')).toBeVisible();
    await expect(courses.getByText('Fictional awards')).toHaveCount(0);
    await picker.selectOption('event');
    await expect(courses.getByText('Fictional overall prizes')).toBeVisible();
    expect(reads).toBe(1);
    expect(detailReads).toBe(0);
    await page.getByRole('button', { name: 'Fictional golfer 1', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { level: 2 })).toBeFocused();
    await expect(dialog.getByText(/Place 1/)).toBeVisible();
    const details = dialog.getByRole('table', { name: 'Allocated winnings by pool' });
    await expect(details.getByRole('columnheader')).toHaveText(['Award / detail', 'Won']);
    await expect(details.locator('.purse-award-pool')).toHaveCount(2);
    await expect(details.getByRole('row', { name: /Designated award/ })).toContainText(/USD\s+1.01/);
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await page.evaluate(() => { document.documentElement.style.fontSize = '125%'; });
      for (const theme of ['light', 'dark']) {
        await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
        for (const cell of await details.locator('tbody th, tbody td').all()) {
          expect(await cell.evaluate((element) => getComputedStyle(element).borderBottomWidth)).toBe('1px');
          expect(await cell.evaluate((element) => getComputedStyle(element).borderBottomStyle)).toBe('solid');
        }
        for (const amount of await details.locator('td').all()) {
          expect(await amount.evaluate((element) => getComputedStyle(element).textAlign)).toBe('end');
        }
        expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
        expect(await details.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
      }
    }
    await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
    await dialog.screenshot({ path: testInfo.outputPath('player-winnings-rows.png') });
    expect(detailReads).toBe(1);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Fictional golfer 1', exact: true })).toBeFocused();
    const refresh = page.getByRole('button', { name: 'Refresh prize results', exact: true });
    await refresh.click();
    await expect(refresh).toBeEnabled();
    await expect(picker).toHaveValue('event');
    expect(reads).toBe(2);
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await page.evaluate(() => { document.documentElement.style.fontSize = '125%'; });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      expect(await picker.evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
      for (const element of await page.locator('.purse-public table, .purse-public-pools').all()) {
        expect(await element.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
      }
    }
    await picker.selectOption(base.rounds[0]?.id ?? '');
    await page.screenshot({ path: testInfo.outputPath('compact-public-purse.png'), fullPage: true });
    limited = true;
    await refresh.click();
    await expect(page.getByRole('alert')).toContainText('Too many requests');
    await expect(page.getByRole('table')).toHaveCount(0);
    limited = false;
    await refresh.click();
    await expect(page.getByRole('table')).toBeVisible();
    expect(reads).toBe(4);
    expect(errors).toEqual([]);
  } finally {
    await server.close();
  }
});
