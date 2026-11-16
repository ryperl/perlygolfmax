import { createServer } from 'vite';
import { expect, test } from './test';
import { catalogExport, catalogVersions } from './catalog-workspace-data';
import { contrastRatio } from './contrast';
import type { Locator } from '@playwright/test';

for (const workflow of ['courses', 'create player', 'edit player'] as const) {
test(`compact catalog ${workflow} workflow preserves complete search and focused editing at narrow widths`, async ({ page }, testInfo) => {
  const server = await createServer({ configFile: false, cacheDir: testInfo.outputPath('vite-cache'),
    server: { host: '127.0.0.1', port: 0, hmr: false }, esbuild: { jsx: 'automatic' },
    optimizeDeps: { noDiscovery: true, include: ['react', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime'] }, logLevel: 'error' });
  const errors: string[] = [];
  page.on('pageerror', (error) => { errors.push(error.message); });
  try {
    await server.listen();
    const address = server.httpServer?.address();
    if (!address || typeof address === 'string') throw new Error('Fictional catalog fixture did not start');
    const origin = `http://127.0.0.1:${String(address.port)}`;
    await page.route(`${origin}/__catalogs`, (route) => route.fulfill({ contentType: 'text/html',
      body: '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="catalog-workspace-fixture"></div><script type="module" src="/tests/smoke/catalog-workspace-fixture.tsx"></script></body></html>' }));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${origin}/__catalogs`);
    await page.evaluate(() => { document.documentElement.style.fontSize = '125%'; });
    async function capture(target: Locator, name: string) {
      if (!process.env.CI) await target.screenshot({ path: testInfo.outputPath(name) });
    }
    async function checkLayout() {
      for (const width of [1280, 390, 320]) {
        await page.setViewportSize({ width, height: 844 });
        for (const theme of ['light', 'dark']) {
          await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
          for (const element of await page.locator('.catalog-editor, .catalog-row, .catalog-form').all()) {
            if (await element.isVisible()) expect(await element.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
          }
          for (const element of await page.locator('.catalog-view input:not([type="checkbox"]), .catalog-view select').all()) {
            if (await element.isVisible()) expect(await element.evaluate((node) => node.getBoundingClientRect().width <= (node.parentElement?.clientWidth ?? 0) + 1)).toBe(true);
          }
        }
      }
    }
    if (workflow === 'courses') {
    const courses = page.getByRole('list', { name: 'Saved courses', exact: true });
    await expect(courses.getByRole('listitem')).toHaveCount(6);
    await expect(page.getByRole('heading', { name: 'Add a course', exact: true })).toHaveCount(0);
    const courseSearch = page.getByRole('searchbox', { name: 'Search courses', exact: true });
    await courseSearch.fill('West Coast');
    await expect(courses.getByRole('listitem')).toHaveCount(1);
    await expect(courses).toContainText('Fictional West Coast');
    await courseSearch.clear();
    const version = catalogVersions[0];
    if (!version) throw new Error('Missing fictional course');
    const firstTee = version.data.teeProfiles[0];
    if (!firstTee) throw new Error('Missing fictional tee');
    await page.getByRole('button', { name: `View ${version.data.name} version`, exact: true }).click();
    const published = page.getByRole('region', { name: 'Published course version', exact: true });
    await expect(published.getByRole('heading')).toBeFocused();
    await expect(published.getByText(version.id, { exact: true })).not.toBeVisible();
    await published.getByText('Version details', { exact: true }).click();
    await expect(published.getByText(version.id, { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Close course details', exact: true }).click();
    await expect(page.getByRole('button', { name: `View ${version.data.name} version`, exact: true })).toBeFocused();
    await page.getByRole('button', { name: `Update ${version.data.name}`, exact: true }).click();
    await page.getByLabel('Course JSON file', { exact: true }).setInputFiles({
      name: 'fictional-course.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(catalogExport(version.data))),
    });
    const preview = page.getByRole('combobox', { name: 'Preview tee', exact: true });
    await expect(preview).toHaveValue('');
    await preview.selectOption(String(firstTee.id));
    await checkLayout();
    await capture(page.locator('.catalog-editor'), 'focused-course-import.png');
    await page.getByRole('button', { name: 'Close import', exact: true }).click();
    await page.getByRole('button', { name: 'Resume import', exact: true }).click();
    await expect(preview).toHaveValue(String(firstTee.id));
    await page.getByRole('button', { name: 'Stage import', exact: true }).click();
    const publish = page.getByRole('button', { name: 'Publish staged version', exact: true });
    await expect(publish).toBeDisabled();
    await page.getByRole('checkbox', { name: /I approve publishing/ }).check();
    await publish.click();
    await expect(page.getByRole('status').filter({ hasText: /Course version .* saved/ })).toBeVisible();
    await page.getByRole('button', { name: 'Close import', exact: true }).click();
    await page.getByRole('button', { name: 'Refresh course catalog', exact: true }).click();
    await expect(courses.getByRole('listitem')).toHaveCount(6);
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      for (const theme of ['light', 'dark']) {
        await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      }
    }
    await capture(page.locator('.catalog-view'), 'compact-course-catalog.png');
    expect(errors).toEqual([]);
    return;
    }
    await page.getByRole('button', { name: 'Fictional Players', exact: true }).click();
    const players = page.getByRole('list', { name: 'Saved players', exact: true });
    await expect(players.getByRole('listitem')).toHaveCount(8);
    await page.getByRole('searchbox', { name: 'Search players', exact: true }).fill('golfer 8');
    await expect(players.getByRole('listitem')).toHaveCount(1);
    await page.getByRole('searchbox', { name: 'Search players', exact: true }).clear();
    if (workflow === 'create player') {
    await page.getByRole('button', { name: 'Add player', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Create a saved player', exact: true })).toBeFocused();
    await expect(page.getByLabel('Initial index effective date', { exact: true })).not.toBeVisible();
    await page.getByLabel('Player display name', { exact: true }).fill('Fictional New Player');
    await page.getByRole('button', { name: 'Save player', exact: true }).click();
    await expect(players.getByRole('listitem')).toHaveCount(9);
    await page.getByLabel('Player display name', { exact: true }).fill('Fictional Scratch Player');
    await expect(page.getByText('Player saved. Handicap index is unknown until manually recorded.', { exact: true })).toHaveCount(0);
    await page.getByLabel('Initial handicap index (optional)', { exact: true }).fill('0');
    await page.getByLabel('Initial index effective date', { exact: true }).fill('2026-01-03');
    await checkLayout();
    await capture(page.locator('.catalog-editor'), 'focused-player-creation.png');
    await page.getByRole('button', { name: 'Save player', exact: true }).click();
    await expect(players.getByRole('listitem')).toHaveCount(10);
    await page.getByRole('button', { name: 'Close player creation', exact: true }).click();
    const newPlayerEdit = page.getByRole('button', { name: 'Edit Fictional New Player', exact: true });
    await newPlayerEdit.click();
    const createdEditor = page.getByRole('region', { name: 'Player editor', exact: true });
    await expect(createdEditor.getByRole('heading')).toBeFocused();
    await createdEditor.getByRole('button', { name: 'Close player editor', exact: true }).click();
    await expect(newPlayerEdit).toBeFocused();
    expect(errors).toEqual([]);
    return;
    }
    await page.getByRole('button', { name: 'Edit Fictional golfer 1', exact: true }).click();
    const editor = page.getByRole('region', { name: 'Player editor', exact: true });
    await expect(editor.getByRole('heading')).toBeFocused();
    await checkLayout();
    await editor.getByLabel('Saved player name', { exact: true }).fill('Fictional Renamed Player');
    await editor.getByRole('button', { name: 'Save player name', exact: true }).click();
    await expect(players.getByRole('heading', { name: 'Fictional Renamed Player', exact: true })).toBeVisible();
    await editor.getByRole('button', { name: 'Handicap', exact: true }).click();
    await editor.getByLabel('Handicap index (explicit + supported)', { exact: true }).fill('+2.1');
    await editor.getByLabel('Effective date', { exact: true }).fill('2026-01-03');
    await editor.getByLabel('Manual source', { exact: true }).fill('Fictional manual report');
    await editor.getByRole('checkbox', { name: /I confirm/ }).check();
    await checkLayout();
    for (const button of await editor.getByRole('group', { name: 'Player editor sections', exact: true }).getByRole('button').all()) {
      expect(await button.evaluate((element) => getComputedStyle(element).whiteSpace)).toBe('nowrap');
    }
    await editor.getByRole('button', { name: 'Save manual index', exact: true }).click();
    await expect(editor.getByRole('status').filter({ hasText: /Manual index observation saved/ })).toBeVisible();
    await editor.getByRole('button', { name: 'History', exact: true }).click();
    const history = editor.getByRole('region', { name: 'Handicap history', exact: true });
    await expect(history.getByRole('listitem')).toContainText('+2.1');
    await expect(history.getByText(/recorded by/)).not.toBeVisible();
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      for (const theme of ['light', 'dark']) {
        await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        for (const target of await editor.getByRole('button').all()) {
          expect(await target.evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
        }
        const colors = await editor.locator('[aria-pressed="true"]').evaluate((element) => ({
          text: getComputedStyle(element).color, background: getComputedStyle(element).backgroundColor,
        }));
        expect(contrastRatio(colors.text, colors.background)).toBeGreaterThanOrEqual(4.5);
      }
    }
    await capture(page.locator('.catalog-view'), 'compact-player-editor.png');
    await editor.getByRole('button', { name: 'Profile', exact: true }).click();
    await editor.getByLabel('Saved player name', { exact: true }).fill('Fictional unsaved name');
    await editor.getByRole('button', { name: 'Close player editor', exact: true }).click();
    await expect(editor.getByRole('alert')).toContainText('Discard local edits');
    await editor.getByRole('button', { name: 'Keep editing', exact: true }).click();
    await expect(editor.getByLabel('Saved player name', { exact: true })).toHaveValue('Fictional unsaved name');
    await editor.getByRole('button', { name: 'Close player editor', exact: true }).click();
    await editor.getByRole('button', { name: 'Discard changes and close', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Edit Fictional Renamed Player', exact: true })).toBeFocused();
    expect(errors).toEqual([]);
  } finally { await server.close(); }
});
}
