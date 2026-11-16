import { createServer } from 'vite';
import { expect, test } from './test';
import { fictionalPurse } from './purse-fixture-data';
import { publicPurseSummary } from '../../src/domain/public-purse';
import { purseTestId } from '../../src/domain/purse.test-support';

test('public purse is compact, course-filtered and refreshed through one minimal read without identity or writes', async ({ page }, testInfo) => {
  const server = await createServer({
    configFile: false, cacheDir: testInfo.outputPath('vite-cache'),
    server: { host: '127.0.0.1', port: 0, hmr: false }, esbuild: { jsx: 'automatic' },
    optimizeDeps: { noDiscovery: true, include: ['react', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime'] },
    logLevel: 'error',
  });
  const base = publicPurseSummary(fictionalPurse(12));
  const first = base.pools[0];
  if (!first) throw new Error('Missing fictional pool');
  const secondRound = purseTestId(2001);
  const summary = { ...base,
    rounds: [...base.rounds, { id: secondRound, label: 'Fictional Desert Course' }],
    pools: [...base.pools, { ...first, id: purseTestId(5001), name: 'Fictional desert prizes', roundId: secondRound, status: 'pending' as const },
      { ...first, id: purseTestId(5002), name: 'Fictional overall prizes', roundId: null, status: 'pending' as const }],
  };
  let reads = 0;
  let limited = false;
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
      expect(url.searchParams.get('view')).toBe('summary');
      reads++;
      await route.fulfill(limited
        ? { status: 429, json: { code: 'REQUEST_LIMIT_EXCEEDED' }, headers: { 'Retry-After': '60' } }
        : { json: summary });
    });
    await page.goto(`${origin}/#purse?event=${summary.eventId}`);
    const picker = page.getByRole('combobox', { name: 'Course', exact: true });
    await expect(picker).toBeVisible();
    await expect(page.getByRole('columnheader')).toHaveText(['Player / pools won', 'Won (USD)']);
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
