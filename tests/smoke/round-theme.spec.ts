import { createServer } from 'vite';
import { expect, test } from './test';
import { contrastRatio } from './contrast';
import type { Locator } from '@playwright/test';

for (const theme of ['light', 'dark']) {
test(`round accents remain distinct and readable without tinting fields or changing round identity (${theme})`, async ({ page }, testInfo) => {
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
    const scores = page.getByRole('region', { name: 'Round scores', exact: true });
    await expect(picker).toBeEnabled();
    await page.evaluate(() => { document.documentElement.style.fontSize = '125%'; });
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
      let birdieColor: string | undefined;
      let saveColor: string | undefined;
      const selectedColors = new Set<string>();
      async function checkAccent(target: Locator, surface: string, line: string) {
        await expect(target).toBeVisible();
        const colors = await target.evaluate((element) => {
          const style = getComputedStyle(element);
          return { background: style.backgroundColor, line: style.borderColor, text: style.color };
        });
        expect(colors.background).toBe(surface);
        expect(colors.line).toBe(line);
        expect(contrastRatio(colors.text, colors.background)).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(colors.line, colors.background)).toBeGreaterThanOrEqual(3);
      }
      for (const option of await picker.getByRole('option').all()) {
        const id = await option.getAttribute('value');
        if (!id) throw new Error('Missing palette round ID');
        await picker.selectOption(id);
        await expect(picker).toBeEnabled();
        const accentBox = picker.locator('..').locator('..');
        expect(await scores.getAttribute('data-round-tone')).toBe(await accentBox.getAttribute('data-round-tone'));
        const palette = await accentBox.evaluate((element) => {
          const style = getComputedStyle(element);
          return { surface: style.backgroundColor, line: style.borderInlineStartColor };
        });
        await scores.getByRole('button', { name: 'Scorecards', exact: true }).click();
        const activeTab = scores.locator('.score-toolbar [aria-pressed="true"]');
        await checkAccent(activeTab, palette.surface, palette.line);
        await page.keyboard.press('Tab');
        await activeTab.focus();
        await expect(activeTab).toBeFocused();
        expect(await activeTab.evaluate((element) => getComputedStyle(element).outlineColor)).toBe(palette.line);
        selectedColors.add(await activeTab.evaluate((element) => getComputedStyle(element).backgroundColor));
        await checkAccent(scores.locator('.scorecard-nine-picker [aria-pressed="true"]').first(), palette.surface, palette.line);
        const subtotal = scores.locator('td.recap-subtotal').first();
        expect(await subtotal.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(palette.surface);
        const mark = scores.locator('.score-birdie').first();
        await expect(mark).toBeVisible();
        const semanticColor = await mark.evaluate((element) => getComputedStyle(element).color);
        birdieColor ??= semanticColor;
        expect(semanticColor).toBe(birdieColor);
        await scores.getByRole('button', { name: 'Enter scores', exact: true }).click();
        expect(await scores.locator('.hole-heading').evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(palette.surface);
        const input = scores.getByRole('textbox').first();
        expect(await input.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(field);
        const primaryColor = await scores.locator('.primary-score-action').evaluate((element) => getComputedStyle(element).backgroundColor);
        saveColor ??= primaryColor;
        expect(primaryColor).toBe(saveColor);
        await scores.getByRole('button', { name: 'KP Competition', exact: true }).click();
        expect(await scores.locator('.kp-group-entries').evaluate((element) => getComputedStyle(element).borderInlineStartColor)).toBe(palette.line);
        expect(await scores.locator('.kp-group-heading .kp-ticket-pin').evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(palette.surface);
        await checkAccent(scores.locator('.kp-ticket-details > summary').first(), palette.surface, palette.line);
        await scores.getByRole('button', { name: 'Games', exact: true }).click();
        expect(await scores.locator('.round-game').first().evaluate((element) => getComputedStyle(element).borderInlineStartColor)).toBe(palette.line);
        await checkAccent(scores.locator('.game-card-nines [aria-pressed="true"]').first(), palette.surface, palette.line);
      }
      expect(selectedColors.size).toBe(8);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const initialTone = await picker.locator('..').locator('..').getAttribute('data-round-tone');
    const third = await picker.getByRole('option', { name: 'Fictional Round 3', exact: true }).getAttribute('value');
    if (!third) throw new Error('Missing fictional round choice');
    await picker.selectOption(third);
    await expect(picker).toBeEnabled();
    const selectedTone = await picker.locator('..').locator('..').getAttribute('data-round-tone');
    expect(selectedTone).not.toBe(initialTone);
    expect(selectedTone).toBe(await headers.nth(2).getAttribute('data-round-tone'));
    await scores.getByRole('button', { name: 'KP Competition', exact: true }).click();
    await expect(scores.getByRole('heading', { name: 'KP Competition', exact: true })).toBeVisible();
    await scores.locator('.kp-group-entries').screenshot({ path: testInfo.outputPath('round-context-kp.png') });
  } finally { await server.close(); }
});
}
