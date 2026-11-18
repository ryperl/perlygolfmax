import type { Locator, Page } from '@playwright/test';
import { expect, test } from './test';
import { contrastRatio } from './contrast';
import { dotsPlayers, openDotsFixture } from './dots-fixture-data';

async function narrowControls(page: Page, scope: Locator) {
  for (const select of await scope.getByRole('combobox').all()) {
    const style = await select.evaluate((element) => {
      const computed = getComputedStyle(element), label = element.closest('label');
      return { height: element.getBoundingClientRect().height, color: computed.color, background: computed.backgroundColor,
        fits: label !== null && label.scrollWidth <= label.clientWidth, tag: element.tagName,
        label: label?.firstChild?.textContent, labelWidth: label?.clientWidth, labelScrollWidth: label?.scrollWidth };
    });
    expect(style.tag).toBe('SELECT');
    expect(style.height).toBeGreaterThanOrEqual(44);
    expect(style.fits, JSON.stringify(style)).toBe(true);
    expect(contrastRatio(style.color, style.background)).toBeGreaterThanOrEqual(4.5);
  }
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

async function stageSpecials(form: Locator, gameName = 'Dots') {
  const first = 'Fictional golfer 1', second = 'Fictional golfer 2';
  await form.getByRole('button', { name: `Dots for ${first} · ${gameName}`, exact: true }).click();
  let dialog = form.getByRole('dialog', { name: `Dots · ${first}`, exact: true });
  for (let count = 0; count < 3; count++) await dialog.getByRole('button', { name: `Increase Sandy for ${first}`, exact: true }).click();
  await dialog.getByRole('button', { name: `Call Paree · ${first}`, exact: true }).click();
  await dialog.getByRole('combobox', { name: `Paree call 1 · ${first}`, exact: true }).selectOption('success');
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  await form.getByRole('button', { name: `Dots for ${second} · ${gameName}`, exact: true }).click();
  dialog = form.getByRole('dialog', { name: `Dots · ${second}`, exact: true });
  await dialog.getByRole('button', { name: `Call Paree · ${second}`, exact: true }).click();
  await dialog.getByRole('combobox', { name: `Paree call 1 · ${second}`, exact: true }).selectOption('failure');
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
}

test('Dots setup stays compact and selects all compatible specials without losing custom units', async ({ page }, testInfo) => {
  test.setTimeout(30000);
  const fixture = await openDotsFixture(page, testInfo);
  try {
    await page.getByRole('button', { name: 'Games', exact: true }).click();
    await page.getByRole('button', { name: 'Add game', exact: true }).click();
    const editor = page.getByRole('form', { name: 'Game settings', exact: true });
    await editor.getByRole('combobox', { name: 'Dots playing group', exact: true }).selectOption('1');
    await editor.getByLabel('Sandy', { exact: true }).check();
    await editor.getByLabel('Sandy units', { exact: true }).fill('3');
    await editor.getByRole('button', { name: 'Select all', exact: true }).click();
    await expect(editor.getByRole('button', { name: 'Select all', exact: true })).toBeDisabled();
    await expect(editor.getByLabel('Sandy units', { exact: true })).toHaveValue('3');
    await expect(editor.getByLabel('Sweep · Automatic', { exact: true })).not.toBeChecked();
    await expect(editor.getByLabel('Assassin · Automatic', { exact: true })).not.toBeChecked();
    for (const theme of ['light', 'dark']) {
      await page.evaluate((value) => {
        document.documentElement.dataset.theme = value;
        document.documentElement.style.fontSize = '125%';
      }, theme);
      for (const width of [320, 390, 1280]) {
        await page.setViewportSize({ width, height: 900 });
        await narrowControls(page, editor);
        const layout = await editor.locator('.dots-special-row').evaluateAll((rows) => rows.map((row) => {
          const label = row.querySelector('.dots-special-toggle'), checkbox = row.querySelector('input[type="checkbox"]');
          const number = row.querySelector('input[type="number"]'), info = row.querySelector('button');
          if (!label || !checkbox || !info) throw new Error('Missing Dots setup controls.');
          const rowBox = row.getBoundingClientRect(), labelBox = label.getBoundingClientRect(), checkBox = checkbox.getBoundingClientRect();
          return { row: { top: rowBox.top, left: rowBox.left, right: rowBox.right, height: rowBox.height },
            label: { height: labelBox.height, fits: label.scrollWidth <= label.clientWidth },
            checkbox: { width: checkBox.width, height: checkBox.height, left: checkBox.left },
            number: number ? { left: number.getBoundingClientRect().left, width: number.getBoundingClientRect().width } : null,
            info: { left: info.getBoundingClientRect().left, width: info.getBoundingClientRect().width, height: info.getBoundingClientRect().height } };
        }));
        for (const item of layout) {
          expect(item.label.height).toBeGreaterThanOrEqual(44);
          expect(item.label.fits).toBe(true);
          expect(item.checkbox.width).toBeLessThanOrEqual(28);
          expect(item.checkbox.height).toBeLessThanOrEqual(28);
          expect(item.checkbox.left - item.row.left).toBeLessThanOrEqual(1);
          expect(item.info.width).toBeGreaterThanOrEqual(44);
          expect(item.info.height).toBeGreaterThanOrEqual(44);
          expect(item.row.height).toBeLessThanOrEqual(90);
          if (item.number) {
            expect(item.number.width).toBeGreaterThanOrEqual(44);
            expect(item.number.left + item.number.width).toBeLessThanOrEqual(item.info.left);
          }
        }
        if (width === 1280) {
          expect(new Set(layout.map((item) => Math.round(item.row.left))).size).toBe(2);
        }
        if (testInfo.project.name === 'desktop-chromium' && width !== 320) {
          await editor.locator('.dots-settings').screenshot({
            path: `coverage/dots-setup-${theme}-${width === 390 ? 'phone' : 'desktop'}.png`,
          });
        }
      }
    }
    await editor.getByRole('button', { name: 'About Hogan', exact: true }).click();
    await expect(editor.locator('.dots-special-description')).toHaveCount(1);
    await editor.getByRole('button', { name: 'About Hogan', exact: true }).click();
    await expect(editor.locator('.dots-special-description')).toHaveCount(0);
    expect(fixture.counters().configWrites).toBe(0);
    await editor.getByRole('button', { name: 'Save game', exact: true }).click();
    await expect(page.getByText('Game settings saved.', { exact: true })).toBeVisible();
    const game = fixture.counters().configurations[0]?.find((game) => game.kind === 'dots');
    expect(game?.specials.find((special) => special.kind === 'sandy')?.units).toBe(3);
    expect(fixture.counters().configWrites).toBe(1);
    expect(fixture.counters().pageErrors).toEqual([]);
  } finally { await fixture.close(); }
});

for (const rotationHoles of [3, 6] as const) {
  test(`new Dots setup offers the ${String(rotationHoles)}-hole rotating format with authoritative API support`, async ({ page }, testInfo) => {
    const fixture = await openDotsFixture(page, testInfo);
    try {
      await page.getByRole('button', { name: 'Games', exact: true }).click();
      await page.getByRole('button', { name: 'Add game', exact: true }).click();
      const editor = page.getByRole('form', { name: 'Game settings', exact: true });
      await editor.getByRole('combobox', { name: 'Dots playing group', exact: true }).selectOption('1');
      await editor.getByRole('combobox', { name: 'Dots mode', exact: true }).selectOption(`rotating-${String(rotationHoles)}`);
      await editor.getByLabel('Sandy', { exact: true }).check();
      await editor.getByLabel('USD per dot difference', { exact: true }).fill('.50');
      await editor.getByRole('button', { name: 'Save game', exact: true }).click();
      await expect(page.getByText('Game settings saved.', { exact: true })).toBeVisible();
      expect(fixture.counters().configurations[0]?.find((game) => game.kind === 'dots')).toMatchObject({
        version: 2, mode: 'rotating', rotationHoles, stakeMinor: 50,
      });
      await page.getByRole('button', { name: 'Enter scores', exact: true }).click();
      await expect(page.getByRole('combobox', { name: 'Dots P1', exact: true })).toBeVisible();
      expect(fixture.counters().writes).toBe(0);
    } finally { await fixture.close(); }
  });

  test(`first-hole order shares Dots with the saved partners and rotates every ${String(rotationHoles)} holes`, async ({ page }, testInfo) => {
    test.setTimeout(30000);
    const fixture = await openDotsFixture(page, testInfo, rotationHoles === 3 ? 'rotating-3' : 'rotating-6');
    try {
      await page.setViewportSize({ width: 320, height: 900 });
      await page.evaluate(() => {
        document.documentElement.dataset.theme = 'dark';
        document.documentElement.style.fontSize = '125%';
      });
      let form = page.getByRole('form', { name: 'Group 1 hole 1 entry', exact: true });
      const order = [dotsPlayers[0], dotsPlayers[2], dotsPlayers[1], dotsPlayers[3]];
      for (const [index, playerId] of order.entries()) {
        if (!playerId) throw new Error('Missing fictional rotating golfer.');
        await form.getByRole('combobox', { name: `Dots P${String(index + 1)}`, exact: true }).selectOption(playerId);
      }
      const stageSandy = async (target: Locator) => {
        await target.getByRole('button', { name: 'Dots for Fictional golfer 1 · Fictional rotating Dots', exact: true }).click();
        const dialog = target.getByRole('dialog', { name: 'Dots · Fictional golfer 1', exact: true });
        await expect(dialog.getByRole('checkbox', { name: /Birdie|Eagle|String|Assassin|Sweep/ })).toHaveCount(0);
        expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
        expect((await dialog.getByRole('button', { name: 'Done', exact: true }).boundingBox())?.height).toBeLessThanOrEqual(52);
        expect((await dialog.locator('.dots-count-control > span').boundingBox())?.height).toBeLessThanOrEqual(32);
        for (const choice of await dialog.locator('.dots-special-choice').all()) {
          expect((await choice.boundingBox())?.height).toBeGreaterThanOrEqual(44);
          expect(await choice.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
        }
        await dialog.getByRole('button', { name: 'Increase Sandy for Fictional golfer 1', exact: true }).click();
        if (testInfo.project.name === 'desktop-chromium' && rotationHoles === 3 && fixture.counters().writes === 0) {
          await dialog.screenshot({ path: 'coverage/dots-quick-entry-dark-phone.png' });
        }
        await dialog.getByRole('button', { name: 'Done', exact: true }).click();
      };
      await stageSandy(form);
      await form.getByRole('button', { name: 'Par for blanks', exact: true }).click();
      expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe('INPUT');
      expect(fixture.counters().writes).toBe(0);
      await form.getByRole('button', { name: 'Save & Next Hole', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Hole 2', exact: true })).toBeVisible();
      expect(fixture.counters().writes).toBe(4);
      expect(fixture.counters().requests[0]?.score.dots?.[0]?.rotation?.playerIds).toEqual(order);
      let result = fixture.read().games?.results.find((result) => result.gameId === '00000000-0000-4000-8000-000000000962')?.dots;
      expect(result?.players.map((player) => player.totalPoints)).toEqual([1, 0, 1, 0]);
      await page.getByRole('combobox', { name: 'Jump to hole', exact: true }).selectOption(String(rotationHoles + 1));
      form = page.getByRole('form', { name: `Group 1 hole ${String(rotationHoles + 1)} entry`, exact: true });
      await expect(form.getByRole('combobox', { name: 'Dots P1', exact: true })).toHaveCount(0);
      await expect(form.getByText('Saved partners · Fictional golfer 1 + Fictional golfer 2 vs Fictional golfer 3 + Fictional golfer 4', { exact: true })).toBeVisible();
      await stageSandy(form);
      await form.getByRole('button', { name: 'Par for blanks', exact: true }).click();
      await form.getByRole('button', { name: 'Save & Next Hole', exact: true }).click();
      await expect(page.getByRole('heading', { name: `Hole ${String(rotationHoles + 2)}`, exact: true })).toBeVisible();
      result = fixture.read().games?.results.find((result) => result.gameId === '00000000-0000-4000-8000-000000000962')?.dots;
      expect(result?.players.map((player) => player.totalPoints)).toEqual([2, 1, 1, 0]);
      expect(result?.holes.find((hole) => hole.number === 1)?.points.map((player) => player.dots)).toEqual([1, 0, 1, 0]);
      await narrowControls(page, page.getByRole('form', {
        name: `Group 1 hole ${String(rotationHoles + 2)} entry`, exact: true,
      }));
      expect(fixture.counters().pageErrors).toEqual([]);
    } finally { await fixture.close(); }
  });
}

test('per-golfer special choices prevent hard conflicts but allow Walk with a warning', async ({ page }, testInfo) => {
  const fixture = await openDotsFixture(page, testInfo, 'rotating-3');
  try {
    await page.getByRole('button', { name: 'Dots for Fictional golfer 1 · Fictional rotating Dots', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Dots · Fictional golfer 1', exact: true });
    await dialog.getByRole('checkbox', { name: 'Hogan for Fictional golfer 1', exact: true }).check();
    await expect(dialog.getByRole('checkbox', { name: 'Seve for Fictional golfer 1', exact: true })).toBeDisabled();
    await expect(dialog.getByRole('checkbox', { name: 'Chippy for Fictional golfer 1', exact: true })).toBeDisabled();
    await expect(dialog.getByRole('button', { name: 'Call Murphy · Fictional golfer 1', exact: true })).toBeDisabled();
    await dialog.getByRole('checkbox', { name: 'Walk for Fictional golfer 1', exact: true }).check();
    await expect(dialog.getByRole('note')).toContainText('This combination is allowed.');
    await dialog.getByRole('checkbox', { name: 'Hogan for Fictional golfer 1', exact: true }).uncheck();
    await dialog.getByRole('checkbox', { name: 'Pully for Fictional golfer 1', exact: true }).check();
    await expect(dialog.getByRole('checkbox', { name: 'Dime for Fictional golfer 1', exact: true })).toBeDisabled();
    await expect(dialog.getByRole('checkbox', { name: 'SuperDime for Fictional golfer 1', exact: true })).toBeDisabled();
    expect(fixture.counters().writes).toBe(0);
  } finally { await fixture.close(); }
});

for (const [theme, mode] of [['light', 'individual'], ['dark', 'fixed']] as const) {
  test(`separate Dots ${mode} setup, staged retry and saved settlement at narrow ${theme}`, async ({ page }, testInfo) => {
    test.setTimeout(30000);
    const fixture = await openDotsFixture(page, testInfo);
    try {
      await page.setViewportSize({ width: 320, height: 900 });
      await page.evaluate((value) => { document.documentElement.dataset.theme = value; document.documentElement.style.fontSize = '125%'; }, theme);
      await page.getByRole('button', { name: 'Games', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Edit Fictional Skins', exact: true })).toHaveCount(0);
      await page.getByRole('button', { name: 'Add game', exact: true }).click();
      const editor = page.getByRole('form', { name: 'Game settings', exact: true });
      await expect(editor.getByRole('combobox', { name: 'Game type', exact: true })).toHaveValue('dots');
      await expect(editor.locator('option[value="skins"]')).toHaveCount(0);
      await editor.getByRole('combobox', { name: 'Dots playing group', exact: true }).selectOption('1');
      await editor.getByRole('combobox', { name: 'Dots mode', exact: true }).selectOption(mode);
      await editor.getByLabel('USD per dot difference', { exact: true }).fill('.50');
      await editor.getByLabel('Sandy', { exact: true }).check();
      await editor.getByLabel('Paree', { exact: true }).check();
      await expect(editor.getByLabel('Sweep · Automatic', { exact: true })).toBeDisabled();
      if (mode === 'individual') await expect(editor.getByLabel('Assassin · Automatic', { exact: true })).toBeDisabled();
      else {
        await expect(editor.getByRole('combobox', { name: 'Side A golfer 1', exact: true })).toHaveValue(dotsPlayers[0] ?? '');
        await expect(editor.getByRole('combobox', { name: 'Side B golfer 1', exact: true })).toHaveValue(dotsPlayers[2] ?? '');
      }
      await narrowControls(page, editor);
      await editor.getByRole('button', { name: 'Save game', exact: true }).click();
      await expect(page.getByText('Game settings saved.', { exact: true })).toBeVisible();
      expect(fixture.counters().configWrites).toBe(1);
      const configured = fixture.counters().configurations[0]?.find((game) => game.kind === 'dots');
      expect(configured).toMatchObject({ kind: 'dots', mode, stakeMinor: 50 });
      const results = page.getByRole('region', { name: 'Dots results', exact: true });
      await expect(results.getByRole('row', { name: /Fictional golfer 1/ }).getByRole('cell').first()).toHaveText('—');
      await page.getByRole('button', { name: 'Enter scores', exact: true }).click();
      const form = page.getByRole('form', { name: 'Group 1 hole 1 entry', exact: true });
      const controls = form.locator(':scope > div > .round-game-hole-controls');
      expect(await form.evaluate((element) => element.querySelector('form'))).toBeNull();
      expect(await controls.evaluate((element) => {
        const scores = element.closest('form')?.querySelector('.group-entry-rows');
        return !!scores && (scores.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
      })).toBe(true);
      for (const article of await form.getByRole('article').all()) {
        expect(await article.evaluate((element) => {
          const raw = element.querySelector('.entry-value'), action = element.querySelector('.dots-entry');
          return !!raw && !!action && (raw.compareDocumentPosition(action) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
        })).toBe(true);
      }
      await expect(form.locator('button[type="submit"], button:not([type])')).toHaveCount(1);
      await stageSpecials(form);
      await narrowControls(page, controls);
      expect(fixture.counters().writes).toBe(0);
      await page.getByRole('button', { name: 'Next hole', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Hole 1', exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Games', exact: true }).click();
      await expect(results.getByRole('row', { name: /Fictional golfer 1/ }).getByRole('cell').first()).toHaveText('—');
      await page.getByRole('button', { name: 'Enter scores', exact: true }).click();
      const rawScores = form.locator('.entry-value input');
      await expect(rawScores).toHaveCount(4);
      await form.getByRole('button', { name: 'Par for blanks', exact: true }).click();
      for (const input of await rawScores.all()) await expect(input).toHaveValue('4');
      fixture.pauseNextFailure();
      await form.getByRole('button', { name: 'Save & Next Hole', exact: true }).click();
      await expect.poll(() => fixture.counters().requests.length).toBe(1);
      await expect(form.getByRole('button', { name: 'Save & Next Hole', exact: true })).toBeDisabled();
      await expect(form.getByRole('button', { name: 'Dots for Fictional golfer 1 · Dots', exact: true })).toBeDisabled();
      expect(fixture.counters().writes).toBe(0);
      await expect(page.getByRole('heading', { name: 'Hole 1', exact: true })).toBeVisible();
      fixture.releaseFailure();
      await expect(form.getByRole('button', { name: 'Save & Next Hole', exact: true })).toBeEnabled();
      await form.getByRole('button', { name: 'Dots for Fictional golfer 1 · Dots', exact: true }).click();
      const dialog = form.getByRole('dialog', { name: 'Dots · Fictional golfer 1', exact: true });
      await expect(dialog.getByLabel('Sandy count · Fictional golfer 1', { exact: true })).toHaveValue('3');
      await dialog.getByRole('button', { name: 'Done', exact: true }).click();
      const failed = fixture.counters().requests[0];
      expect(failed?.score.dots?.[0]?.players.flatMap((player) => player.calls.map((call) => call.result))).toEqual(['success', 'failure']);
      await form.getByRole('button', { name: 'Save & Next Hole', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Hole 2', exact: true })).toBeVisible();
      expect(fixture.counters().writes).toBe(4);
      expect(fixture.counters().requests[1]).toEqual(failed);
      expect(fixture.counters().requests[0]?.playerId).toBe(dotsPlayers[0]);
      await page.getByRole('button', { name: 'Games', exact: true }).click();
      await expect(results.getByRole('row', { name: /Fictional golfer 1/ }).getByRole('cell').first()).toHaveText(mode === 'individual' ? '5' : '4');
      const settlement = page.getByRole('region', { name: 'Group 1 Dots internal settlement', exact: true });
      await expect(settlement).toContainText('Provisional settlement · Not paid');
      await expect(settlement).toContainText(mode === 'individual' ? 'Total to settle: USD 6.50' : 'Total to settle: USD 6.00');
      await expect(settlement.getByRole('row', { name: /Fictional golfer 1/ })).toContainText(mode === 'individual' ? 'Due USD 6.50' : 'Due USD 3.00');
      await results.getByText('Saved award explanations and score evidence', { exact: true }).click();
      await expect(results).toContainText('1 units × 3 × 1');
      await expect(results).toContainText('Failed call · Opponents earn');
      await expect(results).toContainText('Successful call · Calling side earns');
      for (const record of failed?.score.dots ?? []) for (const player of record.players) for (const call of player.calls) {
        await expect(results).not.toContainText(call.id);
      }
      await narrowControls(page, page.getByRole('region', { name: 'Round games', exact: true }));
      expect(fixture.counters().pageErrors).toEqual([]);
    } finally { await fixture.close(); }
  });
}

test('linked earned Wolf and Dots retain separate ledgers and one individual settlement', async ({ page }, testInfo) => {
  test.setTimeout(30000);
  const fixture = await openDotsFixture(page, testInfo, 'linked');
  try {
    const form = page.getByRole('form', { name: 'Group 1 hole 1 entry', exact: true });
    await form.getByRole('combobox', { name: 'Wolf declaration', exact: true }).selectOption('pig');
    await expect(form.getByRole('combobox', { name: 'Wolf match outcome', exact: true })).toHaveCount(0);
    await stageSpecials(form, 'Fictional linked specials');
    for (const input of await form.locator('.group-entry-rows input[inputmode="numeric"]').all()) await input.fill('4');
    await form.getByRole('button', { name: 'Save & Next Hole', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Hole 2', exact: true })).toBeVisible();
    expect(fixture.counters().requests[0]?.score).toMatchObject({ dots: [{ players: [{ counts: { sandy: 3 } }, {}] }], wolf: [{ choice: { mode: 'pig' } }] });
    await page.getByRole('button', { name: 'Games', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Fictional earned Wolf results', exact: true }).getByRole('columnheader', { name: 'Earned dots', exact: true })).toBeVisible();
    const results = page.getByRole('region', { name: 'Fictional linked specials results', exact: true });
    await expect(results.getByRole('row', { name: /Fictional golfer 1/ }).getByRole('cell').first()).toHaveText('15');
    const settlement = page.getByRole('region', { name: 'Group 1 Fictional earned Wolf + Fictional linked specials internal settlement', exact: true });
    await expect(settlement).toHaveCount(1);
    await expect(settlement.getByRole('row', { name: /Fictional golfer 1/ })).toContainText('Due USD 22.50');
    expect(fixture.read().internalSettlements).toHaveLength(1);
    expect(fixture.read().internalSettlements?.[0]?.gameIds).toHaveLength(2);
    expect(fixture.counters().pageErrors).toEqual([]);
  } finally { await fixture.close(); }
});

test('older API capabilities keep Dots and earned Wolf readonly without disabling ordinary raw entry', async ({ page }, testInfo) => {
  test.setTimeout(30000);
  const fixture = await openDotsFixture(page, testInfo, 'old-api');
  try {
    const form = page.getByRole('form', { name: 'Group 1 hole 1 entry', exact: true });
    await expect(form.getByRole('combobox', { name: 'Wolf declaration', exact: true })).toBeDisabled();
    await expect(form.getByRole('button', {
      name: 'Dots for Fictional golfer 1 · Fictional linked specials', exact: true,
    })).toBeDisabled();
    await expect(form.getByLabel('Fictional golfer 1 score', { exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Games', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Add game', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Edit Fictional/ })).toHaveCount(0);
    await expect(page.getByText('This API does not advertise support for editing this game.', { exact: true })).toHaveCount(2);
    expect(fixture.counters().writes).toBe(0);
    expect(fixture.counters().configWrites).toBe(0);
    expect(fixture.counters().pageErrors).toEqual([]);
  } finally { await fixture.close(); }
});
