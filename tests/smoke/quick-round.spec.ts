import { createServer } from 'vite';
import type { Page, TestInfo } from '@playwright/test';
import { expect, test } from './test';
import { contrastRatio } from './contrast';

async function openFixture(page: Page, testInfo: TestInfo, hash: string) {
  const server = await createServer({ configFile: false, cacheDir: testInfo.outputPath('vite-cache'),
    server: { host: '127.0.0.1', port: 0, hmr: false }, esbuild: { jsx: 'automatic' },
    optimizeDeps: { noDiscovery: true, include: ['react', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime'] }, logLevel: 'error' });
  try {
    await server.listen();
    const address = server.httpServer?.address();
    if (!address || typeof address === 'string') throw new Error('Fictional Quick round server unavailable');
    const origin = `http://127.0.0.1:${String(address.port)}`;
    await page.route(`${origin}/__quick-round`, (route) => route.fulfill({ contentType: 'text/html',
      body: '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="quick-round-fixture"></div><script type="module" src="/tests/smoke/quick-round-fixture.tsx"></script></body></html>' }));
    await page.goto(`${origin}/__quick-round${hash}`);
    return server;
  } catch (error) { await server.close(); throw error; }
}

test('a created Quick round can return from scoring to edit its unstarted roster', async ({ page }, testInfo) => {
  const server = await openFixture(page, testInfo, '#events?quick=1');
  try {
    await page.getByLabel('Round / event name').fill('Fictional nine-hole afternoon');
    await page.getByRole('combobox', { name: 'Course', exact: true }).selectOption('ghin:301:302');
    await page.getByLabel('Default tee').selectOption('901');
    await page.getByRole('combobox', { name: 'Round holes', exact: true }).selectOption('back');
    await expect(page.getByLabel('Round holes')).toHaveValue('back');
    await page.getByRole('button', { name: 'Add golfers', exact: true }).click();
    await expect(page.getByRole('checkbox')).toHaveCount(15);
    await expect(page.getByRole('button', { name: 'Next golfers', exact: true })).toHaveCount(0);
    for (let index = 1; index <= 4; index++) await page.getByLabel(`Fictional golfer ${String(index)}`, { exact: true }).check();
    await page.getByRole('button', { name: 'Done choosing golfers', exact: true }).click();
    await expect(page.getByLabel('Fictional golfer 1 group', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Save round', exact: true })).toHaveCount(0);
    const actions = await page.getByRole('region', { name: 'Next steps', exact: true }).boundingBox();
    const groups = await page.locator('.quick-group').last().boundingBox();
    if (!actions || !groups) throw new Error('Missing fictional setup actions');
    expect(actions.y).toBeGreaterThanOrEqual(groups.y + groups.height);
    await page.screenshot({ path: testInfo.outputPath('quick-next-steps.png'), fullPage: true });
    await page.getByRole('button', { name: 'Start scoring', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Save is not confirmed');
    await page.getByRole('button', { name: 'Retry Start scoring', exact: true }).click();
    await expect(page.getByRole('form', { name: 'Group 1 hole 10 entry', exact: true })).toBeVisible();
    await page.getByRole('link', { name: 'Back to event overview', exact: true }).click();
    await page.getByRole('link', { name: 'Edit Quick round', exact: true }).click();
    await page.getByRole('button', { name: 'Add golfers', exact: true }).click();
    const golfer = page.getByRole('checkbox', { name: 'Fictional golfer 1', exact: true });
    await expect(golfer).toBeEnabled();
    await expect(golfer).toBeChecked();
    await expect(page.getByLabel('Round holes')).toHaveValue('back');
    await page.getByRole('button', { name: 'Edit Group 1', exact: true }).click();
    await expect(page.getByLabel('Group 1 starting hole').locator('option')).toHaveCount(9);
    await golfer.uncheck();
    await page.getByRole('button', { name: 'Start scoring', exact: true }).click();
    await expect(page.getByRole('form', { name: 'Group 1 hole 10 entry', exact: true })).toBeVisible();
    await expect(page.getByRole('article', { name: 'Fictional golfer 1 scorecard', exact: true })).toHaveCount(0);
  } finally { await server.close(); }
});

for (const theme of ['light', 'dark']) {
  test(`public directory actions remain spaced, touch-sized and keyboard-accessible in ${theme}`, async ({ page }, testInfo) => {
    const server = await openFixture(page, testInfo, '#events?choose=1');
    try {
      await expect(page.getByRole('heading', { name: 'Fictional Quick round', exact: true })).toBeVisible();
      const create = page.getByRole('link', { name: 'New Quick round', exact: true });
      const refresh = page.getByRole('button', { name: 'Refresh events', exact: true });
      await page.evaluate((value) => { document.documentElement.dataset.theme = value; document.documentElement.style.fontSize = '125%'; }, theme);
      for (const width of [320, 390, 1280]) {
        await page.setViewportSize({ width, height: 900 });
        const bounds = await create.boundingBox(), secondary = await refresh.boundingBox();
        const description = await page.getByText('Open an event to enter scores, view standings and see winnings.').boundingBox();
        if (!bounds || !secondary || !description) throw new Error('Missing directory action layout');
        expect(bounds.height).toBeGreaterThanOrEqual(44);
        expect(secondary.height).toBeGreaterThanOrEqual(44);
        expect(bounds.y - description.y - description.height).toBeGreaterThanOrEqual(15);
        if (secondary.y >= bounds.y + bounds.height) expect(secondary.y - bounds.y - bounds.height).toBeGreaterThanOrEqual(11);
        else {
          expect(secondary.x - bounds.x - bounds.width).toBeGreaterThanOrEqual(19);
          expect(Math.abs(bounds.height - secondary.height)).toBeLessThanOrEqual(1);
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        if (width === 390 && !process.env.CI) await page.screenshot({ path: `coverage/quick-round-actions-${theme}.png`, fullPage: true });
      }
      const colors = await create.evaluate((element) => ({ text: getComputedStyle(element).color, background: getComputedStyle(element).backgroundColor }));
      expect(contrastRatio(colors.text, colors.background)).toBeGreaterThanOrEqual(4.5);
      await page.setViewportSize({ width: 320, height: 900 });
      await page.getByRole('button', { name: 'Archive Quick round: Fictional Quick round', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Archive Fictional Quick round?', exact: true })).toBeFocused();
      await expect(page.getByText(/Saved scores and history are retained/)).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.getByRole('button', { name: 'Archive round', exact: true }).click();
      await expect(page.getByText('No active events.', { exact: true })).toBeVisible();
      await page.keyboard.press('Tab');
      await create.focus();
      await expect(create).toBeFocused();
      await expect(create).toHaveCSS('outline-style', 'solid');
      await page.keyboard.press('Tab');
      await refresh.focus();
      await expect(refresh).toBeFocused();
      await page.keyboard.press('Shift+Tab');
      await create.focus();
      await page.keyboard.press('Enter');
      await expect(page.getByRole('heading', { name: 'Play a Quick round' })).toBeVisible();
    } finally { await server.close(); }
  });
}

for (const width of [320, 1280]) {
  test(`public Quick round retains uncertain saves and full setup at ${String(width)}px`, async ({ page }, testInfo) => {
    const server = await openFixture(page, testInfo, '#events?quick=1');
    try {
      await page.setViewportSize({ width, height: 900 });
      await expect(page.getByRole('heading', { name: 'Play a Quick round' })).toBeVisible();
      await expect(page.getByText('Public round · anyone can edit setup and games.')).toBeVisible();
      await page.getByLabel('Round / event name').fill('Fictional public afternoon');
      await page.getByRole('combobox', { name: 'Course', exact: true }).selectOption('ghin:301:302');
      await page.getByLabel('Default tee').selectOption('901');
      await page.getByRole('button', { name: 'Add golfers', exact: true }).click();
      for (let index = 1; index <= 5; index++) await page.getByLabel(`Fictional golfer ${String(index)}`, { exact: true }).check();
      await page.getByRole('button', { name: 'Done choosing golfers', exact: true }).click();
      await expect(page.getByLabel('Fictional golfer 1 group', { exact: true })).toHaveCount(0);
      await page.getByRole('button', { name: 'Edit Group 2', exact: true }).click();
      await page.getByLabel('Group 2 starting hole').selectOption('10');
      await page.getByRole('button', { name: 'Open full setup' }).click();
      await expect(page.getByLabel('Round / event name')).toHaveValue('Fictional public afternoon');
      await page.getByLabel('Tee time').fill('13:30');
      await page.evaluate(() => { document.documentElement.style.fontSize = '125%'; });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      for (const control of await page.locator('.quick-round select, .quick-round input:not([type="checkbox"]), .quick-golfer-options label').all()) {
        expect((await control.boundingBox())?.height).toBeGreaterThanOrEqual(44);
      }
      await page.getByRole('button', { name: 'Compact setup' }).click();
      await page.getByRole('button', { name: 'Add games', exact: true }).click();
      await expect(page.getByRole('alert')).toContainText('Save is not confirmed');
      await page.getByRole('button', { name: 'Open full setup' }).click();
      await expect(page.getByLabel('Round / event name')).toHaveValue('Fictional public afternoon');
      await expect(page.getByLabel('Round / event name')).toBeDisabled();
      await page.getByRole('button', { name: 'Retry Add games', exact: true }).click();
      await expect(page.getByRole('form', { name: 'Game settings', exact: true })).toBeVisible();
      await expect(page.getByLabel('Tee time')).toHaveValue('13:30');
      await expect(page.getByLabel('Group 2 starting hole')).toHaveValue('10');
      await expect(page.getByRole('button', { name: 'Start scoring' })).toBeDisabled();
      const kinds = page.getByRole('combobox', { name: 'Game type', exact: true });
      for (const kind of ['stableford', 'ball-drop', 'skins', 'churchy']) await expect(kinds.locator(`option[value="${kind}"]`)).toHaveCount(1);
      await kinds.selectOption('churchy');
      await expect(page.getByRole('combobox', { name: 'Churchie playing group', exact: true })).toHaveValue('1');
      await expect(page.getByLabel('Game name', { exact: true })).toBeEnabled();
      await page.getByLabel('Game name', { exact: true }).fill('Fictional afternoon Churchie');
      const fieldOrder = await page.getByRole('form', { name: 'Game settings', exact: true })
        .locator('input, select').evaluateAll((controls) => controls.slice(0, 3).map((control) => control.closest('label')?.textContent.trim() ?? ''));
      expect(fieldOrder).toEqual([expect.stringMatching(/^Game type/), 'Game name', expect.stringMatching(/^Churchie playing group/)]);
      await expect(page.getByRole('combobox', { name: 'Choose Churchie partners', exact: true })).toHaveValue('approach');
      await page.getByText(/^Specials and presets ·/).click();
      await expect(page.getByRole('combobox', { name: 'Specials preset', exact: true })).toBeVisible();
      await expect(page.getByText('Custom presets unavailable here. Built-in presets still work.', { exact: true })).toHaveCount(0);
      await page.getByRole('button', { name: 'Cancel editing', exact: true }).click();
      await page.getByRole('button', { name: 'Back to round setup', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Add game', exact: true })).not.toBeVisible();
      await expect(page.getByRole('button', { name: 'Start scoring' })).toBeEnabled();
      await page.screenshot({ path: testInfo.outputPath('compact-quick-setup.png'), fullPage: true });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.getByRole('button', { name: 'Start scoring' }).focus();
      await expect(page.getByRole('button', { name: 'Start scoring' })).toBeFocused();
      expect(await page.evaluate(() => ({ local: Object.keys(localStorage), session: Object.keys(sessionStorage) }))).toEqual({ local: [], session: [] });
    } finally { await server.close(); }
  });
}
