import { test, expect } from './test';
import { createServer } from 'vite';
import type { Locator } from '@playwright/test';
import { controlStyle } from './control-style';

test('KP during/afterward, exact tied purse, closure and reopen at 320px / 125% text', async ({ page }, testInfo) => {
  const server = await createServer({
    configFile: false, cacheDir: testInfo.outputPath('vite-cache'),
    server: { host: '127.0.0.1', port: 0, hmr: false }, esbuild: { jsx: 'automatic' },
    optimizeDeps: { noDiscovery: true, include: ['react', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime'] },
    logLevel: 'error',
  });
  try {
    await server.listen();
    const address = server.httpServer?.address();
    if (!address || typeof address === 'string') throw new Error('Fictional KP server unavailable');
    const origin = `http://127.0.0.1:${String(address.port)}`;
    await page.route(`${origin}/__kp`, (route) => route.fulfill({
      contentType: 'text/html', body: '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="kp-fixture"></div><script type="module" src="/tests/smoke/kp-fixture.tsx"></script></body></html>',
    }));
    await page.setViewportSize({ width: 320, height: 844 });
    await page.goto(`${origin}/__kp`);
    await page.evaluate(() => { document.documentElement.style.fontSize = '125%'; });
    await page.getByRole('button', { name: 'KP Competition', exact: true }).click();
    await page.getByRole('button', { name: 'Configure KP Competition' }).click();
    await expect(page.getByText(/Entries open/)).toBeVisible();
    const pickerStyles: { readonly theme: string; readonly styles: readonly ReturnType<typeof controlStyle>[] }[] = [];
    async function checkPicker(picker: Locator) {
      expect(await picker.evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
      expect(await picker.evaluate((element) => element.getBoundingClientRect().width
        <= (element.parentElement?.getBoundingClientRect().width ?? 0) + 1)).toBe(true);
      expect(await picker.evaluate((element) => getComputedStyle(element).contain)).toContain('layout');
      await picker.focus();
      await expect(picker).toBeFocused();
      expect(await picker.evaluate((element) => getComputedStyle(element).outlineWidth)).toBe('3px');
    }
    for (const theme of ['light', 'dark']) {
      await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
      const styles: ReturnType<typeof controlStyle>[] = [];
      for (const picker of await page.locator('.kp-panel select').all()) {
        await checkPicker(picker); styles.push(await picker.evaluate(controlStyle));
      }
      expect(styles).toHaveLength(2);
      pickerStyles.push({ theme, styles });
    }
    await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
    const entryGroup = page.getByRole('article', { name: 'KP entry group', exact: true });
    for (const name of ['Fictional golfer 1', 'Fictional golfer 2', 'Fictional golfer 3', 'Fictional golfer 4']) {
      const row = entryGroup.getByRole('group', { name: `${name} KP entry`, exact: true });
      await expect(row.getByRole('heading', { name, exact: true })).toBeVisible();
      await expect(row.getByRole('button', { name: `KP for ${name}`, exact: true })).toBeVisible();
    }
    await page.getByRole('button', { name: 'Enter scores', exact: true }).click();
    await page.getByRole('textbox', { name: 'Fictional golfer 1 score', exact: true }).fill('3');

    async function measure(name: string, feet = '1', inches = '0') {
      const trigger = page.getByRole('button', { name: `KP for ${name}`, exact: true });
      await trigger.click();
      const dialog = page.getByRole('dialog', { name: `KP · ${name}`, exact: true });
      await expect(dialog.getByRole('heading')).toBeFocused();
      await expect(dialog.getByRole('button', { name: 'Stage measurement' })).toBeDisabled();
      await dialog.getByLabel('Feet', { exact: true }).fill(feet);
      await dialog.getByLabel('Inches (0–11)').fill(inches);
      await dialog.getByLabel('Ball finished on the green').check();
      expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
      for (const target of await dialog.locator('button, label').all()) {
        expect(await target.evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
      }
      await dialog.getByRole('button', { name: 'Stage measurement' }).click();
      await expect(trigger).toBeFocused();
      await expect(trigger).toContainText('unsaved');
    }
    await measure('Fictional golfer 1', '0', '0');
    await page.getByRole('button', { name: 'Next hole', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Hole 1', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Save & Next Hole' }).click();
    await expect(page.getByRole('heading', { name: 'Hole 2', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'KP Competition', exact: true }).click();
    await measure('Fictional golfer 1');
    await measure('Fictional golfer 2');
    await page.getByRole('button', { name: 'Save KP entries' }).click();
    const second = page.getByRole('article', { name: 'KP hole 2 results' });
    await expect(second).toContainText('tied, organizer decision required');
    await page.getByRole('combobox', { name: 'KP hole', exact: true }).selectOption('3');
    await measure('Fictional golfer 1');
    await page.getByRole('button', { name: 'Save KP entries' }).click();
    await expect(page.getByRole('article', { name: 'KP hole 3 results' })).toContainText('1 ft 0 in');
    await page.getByRole('button', { name: 'Fictional purse' }).click();
    await page.getByRole('button', { name: 'Edit purse', exact: true }).click();
    await page.getByRole('button', { name: 'Add award pool' }).click();
    await page.getByLabel('Pool 2 name', { exact: true }).fill('Fictional daily KP');
    const source = page.getByRole('combobox', { name: 'Pool 2 source', exact: true });
    for (const { theme, styles } of pickerStyles) {
      await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
      const reference = await source.evaluate(controlStyle);
      for (const style of styles) expect(style).toEqual(reference);
    }
    await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
    const option = source.getByRole('option', { name: /KP Competition/ });
    await source.selectOption(await option.getAttribute('value') ?? '');
    await expect(page.getByLabel('Pool 2 total pot amount')).toHaveValue('100.00');
    await page.getByLabel('Planned budget amount').fill('102.00');
    await page.getByRole('button', { name: 'Save purse', exact: true }).click();
    await expect(page.getByText('Purse settings saved.')).toBeVisible();
    await page.getByRole('button', { name: 'Fictional round' }).click();
    await page.getByRole('button', { name: 'KP Competition', exact: true }).click();
    await page.getByRole('button', { name: 'Close KP entries' }).click();
    await expect(page.getByRole('status').filter({ hasText: /^Entries closed$/ })).toBeVisible();
    await expect(page.getByText(/Closest on-green ball on each|ordinary golf scoring remains open|Round pot:/)).toHaveCount(0);
    await expect(page.getByRole('article', { name: 'KP hole 1 results' })).toContainText('USD 33.34');
    await expect(page.getByRole('article', { name: 'KP hole 4 results' })).toContainText('excluded from daily pot shares');
    const tie = page.getByRole('article', { name: 'KP hole 2 results' });
    const winner = tie.getByRole('combobox', { name: 'Chosen winner', exact: true });
    for (const { theme, styles } of pickerStyles) {
      await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
      await checkPicker(winner);
      expect(await winner.evaluate(controlStyle)).toEqual(styles[0]);
    }
    await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
    await expect(tie.getByRole('button', { name: 'Split tied hole prize' })).toBeDisabled();
    await tie.getByRole('checkbox', { name: 'Extra cent: Fictional golfer 1' }).check();
    await tie.getByRole('button', { name: 'Split tied hole prize' }).click();
    await expect(tie).toContainText('Fictional golfer 1: USD 16.67 planned award');
    await expect(tie).toContainText('Fictional golfer 2: USD 16.66 planned award');
    await expect(page.getByText(/Fully allocated planned awards/)).toHaveCount(0);
    await page.getByRole('button', { name: 'Fictional purse' }).click();
    const pool = page.getByText('Fictional daily KP · calculated', { exact: true });
    await expect(pool).toBeVisible();
    await pool.click();
    await expect(page.getByText('Total pot: USD 100.00.', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Fictional round' }).click();
    await page.getByRole('button', { name: 'Enter scores', exact: true }).click();
    await expect(page.getByRole('button', { name: 'KP for Fictional golfer 1', exact: true })).toBeDisabled();
    await page.getByRole('textbox', { name: 'Fictional golfer 1 score', exact: true }).fill('4');
    await page.getByRole('button', { name: 'Save & Next Hole' }).click();
    await expect(page.getByRole('heading', { name: 'Hole 2', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'KP Competition', exact: true }).click();
    await page.getByRole('button', { name: 'Reopen KP entries' }).click();
    await expect(page.getByText(/Entries open/)).toBeVisible();
    await page.getByRole('button', { name: 'KP for Fictional golfer 1', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Clear KP entry' }).click();
    await page.getByRole('button', { name: 'Save KP entries' }).click();
    await expect(page.getByRole('button', { name: 'KP for Fictional golfer 1', exact: true })).toContainText('Not entered');
    await page.getByRole('button', { name: 'Games', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Round games', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Fictional game', exact: true })).toBeVisible();
    for (const select of await page.getByRole('combobox').all()) {
      expect(await select.evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  } finally { await server.close(); }
});
