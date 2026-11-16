import { createServer } from 'vite';
import { expect, test } from './test';
import { contrastRatio } from './contrast';

test('round accents remain distinct and readable without tinting fields or changing round identity', async ({ page }, testInfo) => {
  const server = await createServer({ configFile: false, cacheDir: testInfo.outputPath('vite-cache'),
    server: { host: '127.0.0.1', port: 0, hmr: false }, esbuild: { jsx: 'automatic' },
    optimizeDeps: { noDiscovery: true, include: ['react', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime'] }, logLevel: 'error' });
  try {
    await server.listen();
    const address = server.httpServer?.address();
    if (!address || typeof address === 'string') throw new Error('Fictional round theme server unavailable');
    const origin = `http://127.0.0.1:${String(address.port)}`;
    await page.route(`${origin}/__round-theme`, (route) => route.fulfill({ contentType: 'text/html',
      body: '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="round-theme-fixture"></div><script type="module" src="/tests/smoke/round-theme-fixture.tsx"></script></body></html>' }));
    await page.setViewportSize({ width: 320, height: 844 });
    await page.goto(`${origin}/__round-theme`);
    const headers = page.locator('.event-trip-round-heading[data-round-tone]');
    await expect(headers).toHaveCount(8);
    const picker = page.getByRole('combobox', { name: 'Round', exact: true });
    await expect(picker).toBeEnabled();
    await page.evaluate(() => { document.documentElement.style.fontSize = '125%'; });
    for (const theme of ['light', 'dark']) {
      await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
      const colors = await headers.evaluateAll((elements) => elements.map((element) => {
        const heading = element.querySelector('h3');
        const text = element.querySelector('p');
        const link = element.querySelector('a');
        if (!heading || !text || !link) throw new Error('Missing round header content');
        const style = getComputedStyle(element);
        return { background: style.backgroundColor, edge: style.borderInlineStartColor, heading: getComputedStyle(heading).color,
          text: getComputedStyle(text).color, link: getComputedStyle(link).color };
      }));
      expect(new Set(colors.map((entry) => entry.background)).size).toBe(8);
      for (const color of colors) {
        expect(contrastRatio(color.heading, color.background)).toBeGreaterThanOrEqual(7);
        expect(contrastRatio(color.text, color.background)).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(color.link, color.background)).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(color.edge, color.background)).toBeGreaterThanOrEqual(3);
      }
      const field = await picker.evaluate((element) => getComputedStyle(element).backgroundColor);
      const accent = await picker.locator('..').locator('..').evaluate((element) => getComputedStyle(element).backgroundColor);
      expect(field).not.toBe(accent);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    const initialTone = await picker.locator('..').locator('..').getAttribute('data-round-tone');
    const third = await picker.getByRole('option', { name: 'Fictional Round 3', exact: true }).getAttribute('value');
    if (!third) throw new Error('Missing fictional round choice');
    await picker.selectOption(third);
    await expect(picker).toBeEnabled();
    const selectedTone = await picker.locator('..').locator('..').getAttribute('data-round-tone');
    expect(selectedTone).not.toBe(initialTone);
    expect(selectedTone).toBe(await headers.nth(2).getAttribute('data-round-tone'));
    await page.screenshot({ path: testInfo.outputPath('pastel-round-accents.png'), fullPage: true });
  } finally { await server.close(); }
});
