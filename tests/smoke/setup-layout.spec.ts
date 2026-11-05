import { expect, test } from './test';
import { createServer } from 'vite';

test('real setup controls preserve drafts and fit narrow, enlarged and dark layouts', async ({ page }, testInfo) => {
  const server = await createServer({
    configFile: false, cacheDir: testInfo.outputPath('vite-cache'),
    server: { host: '127.0.0.1', port: 0, hmr: false },
    esbuild: { jsx: 'automatic' },
    optimizeDeps: { noDiscovery: true, include: ['react', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime'] },
    logLevel: 'error',
  });
  try {
    await server.listen();
    const address = server.httpServer?.address();
    if (!address || typeof address === 'string') throw new Error('Fictional setup server did not start.');
    const origin = `http://127.0.0.1:${String(address.port)}`;
    await page.route(`${origin}/__setup-fixture`, (route) => route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">
        <script>(() => {
          const param = new URLSearchParams(window.location.search).get("clawpilotTheme");
          const theme = param || (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
          document.documentElement.setAttribute("data-theme", theme);
        })();</script></head><body><div id="setup-fixture"></div>
        <script type="module" src="/tests/smoke/setup-fixture.tsx"></script></body></html>`,
    }));
    const errors: string[] = [];
    page.on('pageerror', (error) => { errors.push(error.message); });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${origin}/__setup-fixture`);
    const first = page.getByRole('textbox', { name: 'Round 1 name', exact: true });
    await expect(first).toBeEnabled();
    await expect(page.getByRole('textbox', { name: 'Workspace name' })).not.toBeVisible();
    await expect(page.getByText(/^Matches saved setup\./)).toBeVisible();
    await first.fill('Fictional first-round draft');
    const picker = page.getByRole('combobox', { name: 'Selected round' });
    await picker.selectOption({ label: 'Round 2: Fictional round 2 — Saved' });
    await expect(first).not.toBeVisible();
    const second = page.getByRole('textbox', { name: 'Round 2 name', exact: true });
    await second.fill('Fictional second-round draft');
    await picker.selectOption({ label: 'Round 1: Fictional first-round draft — Unsaved changes' });
    await expect(first).toHaveValue('Fictional first-round draft');
    const save = page.getByRole('button', { name: 'Save event workspace' });
    await save.click();
    await expect(page.getByRole('status')).toContainText('Event workspace saved.');
    await expect(page.getByText(/^Matches saved setup\./)).toBeVisible();
    await picker.selectOption({ label: 'Round 2: Fictional second-round draft — Saved' });
    await expect(second).toHaveValue('Fictional second-round draft');
    await page.getByText('2. Players (4 selected)', { exact: true }).click();
    const search = page.getByRole('searchbox', { name: 'Find players' });
    await search.fill('no matching fictional player');
    await expect(page.getByRole('checkbox', { checked: true })).toHaveCount(4);
    await search.press('Enter');
    await expect(page.getByText(/^Matches saved setup\./)).toBeVisible();
    await search.clear();
    await page.getByRole('checkbox', { name: 'Fictional Player 5 — HI Unknown', exact: true }).check();
    const fifthGroup = page.getByRole('combobox', { name: 'Fictional Player 5 — round 2 group', exact: true });
    await expect(fifthGroup.getByRole('option', { name: 'Group 1 (4/4, full)', exact: true })).toHaveJSProperty('disabled', true);
    const firstGroup = page.getByRole('combobox', { name: 'Fictional Player 1 — round 2 group', exact: true });
    await expect(firstGroup.getByRole('option', { name: 'Group 1 (4/4, full)', exact: true })).toHaveJSProperty('disabled', false);
    await fifthGroup.focus();
    await expect(fifthGroup).toBeFocused();
    await fifthGroup.selectOption('1');
    await expect(fifthGroup).toHaveValue('');
    await expect(page.getByRole('alert')).toContainText('Group 1 is full.');
    await firstGroup.selectOption('2');
    await expect(fifthGroup.getByRole('option', { name: 'Group 1 (3/4)', exact: true })).toHaveJSProperty('disabled', false);
    await fifthGroup.selectOption('1');
    await expect(fifthGroup).toHaveValue('1');
    await expect(firstGroup).toHaveValue('2');
    await expect(firstGroup.getByRole('option', { name: 'Group 1 (4/4, full)', exact: true })).toHaveJSProperty('disabled', true);
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await page.evaluate(() => { document.documentElement.style.fontSize = '125%'; });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.evaluate(() => { document.documentElement.setAttribute('data-theme', 'dark'); });
    await page.getByText('2. Players (5 selected)', { exact: true }).click();
    await page.getByRole('heading', { name: 'Configure event setup' }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: `.azure/setup-cleanup-${testInfo.project.name}.png` });
    await page.getByRole('button', { name: 'Add Round' }).click();
    await expect(page.getByRole('textbox', { name: 'Round 3 name', exact: true })).toBeVisible();
    await expect(page.getByRole('status')).toContainText('Unsaved changes across this event');
    await expect(save).toBeDisabled();
    await picker.selectOption({ label: 'Round 1: Fictional first-round draft — Saved' });
    await expect(page.getByRole('complementary', { name: 'Setup needs attention' })).toContainText('Round 3: enter a round name.');
    await expect(save).toBeDisabled();
    expect(errors).toEqual([]);
  } finally {
    await server.close();
  }
});
