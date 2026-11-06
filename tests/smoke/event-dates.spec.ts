import { createServer } from 'vite';
import { expect, test } from './test';
import type { EventSummary } from '../../src/domain/events';

test('public date order waits for every directory page and recovers a quota page without losing prior events', async ({ page }, testInfo) => {
  const server = await createServer({
    configFile: false, cacheDir: testInfo.outputPath('vite-cache'),
    server: { host: '127.0.0.1', port: 0, hmr: false }, esbuild: { jsx: 'automatic' },
    optimizeDeps: { noDiscovery: true, include: ['react', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime'] },
    logLevel: 'error',
  });
  const event: EventSummary = { id: '00000000-0000-4000-8000-000000000001', name: 'Fictional Later',
    createdAt: '2026-01-01T00:00:00Z', role: 'viewer', status: 'active', etag: 'fictional', startDate: '2026-11-08' };
  let firstReads = 0;
  let nextReads = 0;
  const errors: string[] = [];
  page.on('pageerror', (error) => { errors.push(error.message); });
  try {
    await server.listen();
    const address = server.httpServer?.address();
    if (!address || typeof address === 'string') throw new Error('Event date fixture server did not start.');
    const origin = `http://127.0.0.1:${String(address.port)}`;
    await page.route(`${origin}/`, (route) => route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="public-app-fixture"></div><script type="module" src="/tests/smoke/public-app-fixture.tsx"></script></body></html>',
    }));
    await page.route(`${origin}/__public-api/**`, async (route) => {
      const request = route.request();
      expect(request.method()).toBe('GET');
      expect(request.headers().authorization).toBeUndefined();
      const url = new URL(request.url());
      expect(url.pathname).toBe('/__public-api/public/events');
      if (!url.searchParams.has('continuationToken')) {
        firstReads++;
        await route.fulfill({ json: { events: [event], continuationToken: 'fictional-next' } });
        return;
      }
      expect(url.searchParams.get('continuationToken')).toBe('fictional-next');
      nextReads++;
      if (nextReads === 1) {
        await route.fulfill({ status: 429, headers: { 'Retry-After': '1' }, json: { code: 'Fictional quota' } });
        return;
      }
      const { startDate: omitted, ...undated } = event;
      void omitted;
      await route.fulfill({ json: { events: [
        { ...event, id: '00000000-0000-4000-8000-000000000002', name: 'Fictional Earlier', startDate: '2024-02-29' },
        { ...undated, id: '00000000-0000-4000-8000-000000000003', name: 'Fictional Undated' },
      ] } });
    });
    await page.setViewportSize({ width: 320, height: 740 });
    await page.goto(`${origin}/#events?choose=1`);
    await expect(page.getByRole('alert')).toContainText('directory is incomplete');
    await expect(page.getByRole('list', { name: 'Active events' })).toHaveCount(0);
    await expect(page.getByText('Fictional Later', { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Try again', exact: true }).click();
    await expect(page.locator('ul[aria-label="Active events"] h2')).toHaveText(['Fictional Earlier', 'Fictional Later', 'Fictional Undated']);
    await expect(page.getByText('February 29, 2024', { exact: true })).toHaveAttribute('datetime', '2024-02-29');
    expect(firstReads).toBe(1);
    expect(nextReads).toBe(2);
    await expect(page.getByRole('button', { name: 'Next page' })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await server.close();
  }
});
