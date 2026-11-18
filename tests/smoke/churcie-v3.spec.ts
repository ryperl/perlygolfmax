import type { Page } from '@playwright/test';
import { expect, test } from './test';
import { churciePlayers, openChurcieV3Fixture } from './churcie-v3-fixture';
import { dotsSpecialCatalog } from '../../src/domain/dots';

async function order(page: Page) {
  await page.getByRole('combobox', { name: 'Closest approach', exact: true }).selectOption(churciePlayers[1] ?? '');
  await page.getByRole('combobox', { name: 'Farthest approach', exact: true }).selectOption(churciePlayers[0] ?? '');
  await page.getByRole('combobox', { name: 'Next farthest approach', exact: true }).selectOption(churciePlayers[3] ?? '');
}

async function savePar(page: Page, hole: number) {
  const form = page.getByRole('form', { name: `Group 1 hole ${String(hole)} entry`, exact: true });
  await form.getByRole('button', { name: 'Par for blanks', exact: true }).click();
  await form.getByRole('button', { name: 'Save & Next Hole', exact: true }).click();
  await expect(page.getByRole('form', { name: `Group 1 hole ${String(hole + 1)} entry`, exact: true })).toBeVisible();
}

test('Churcie approach order and Sticky/Sandy calls survive a failed lean acknowledgement and rotate after three played holes', async ({ page }, testInfo) => {
  const fixture = await openChurcieV3Fixture(page, testInfo);
  try {
    await order(page);
    const form = page.getByRole('form', { name: 'Group 1 hole 10 entry', exact: true });
    await form.getByRole('button', { name: 'Par for blanks', exact: true }).click();
    await form.getByLabel('Fictional golfer 2 score', { exact: true }).fill('3');
    await page.getByRole('button', { name: 'Dots for Fictional golfer 2 · Churcie', exact: true }).click();
    let dialog = page.getByRole('dialog', { name: 'Dots · Fictional golfer 2', exact: true });
    await dialog.getByLabel('Sticky for Fictional golfer 2', { exact: true }).check();
    expect(await dialog.getByLabel('Sticky for Fictional golfer 2', { exact: true }).evaluate((element) =>
      element instanceof HTMLInputElement && element.type === 'checkbox' && element.checked)).toBe(true);
    await expect(dialog.getByLabel('Dime for Fictional golfer 2', { exact: true })).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Increase Sandy for Fictional golfer 2', exact: true }).click();
    await dialog.getByRole('button', { name: 'Call Murphy · Fictional golfer 2', exact: true }).click();
    await dialog.getByRole('combobox', { name: 'Murphy call 1 · Fictional golfer 2', exact: true }).selectOption('success');
    await dialog.getByRole('combobox', { name: 'Murphy press stage 1 · Fictional golfer 2', exact: true }).selectOption('1');
    if (testInfo.project.name !== 'desktop-chromium') await page.screenshot({ path: testInfo.outputPath('churcie-specials-phone.png') });
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
    fixture.failNextAcknowledgement();
    await form.getByRole('button', { name: 'Save & Next Hole', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Service request failed (503). Nothing was confirmed saved.');
    expect(fixture.counters().requests).toHaveLength(1);
    expect(fixture.counters().writes).toBe(0);
    await expect(form.getByLabel('Fictional golfer 2 score', { exact: true })).toHaveValue('3');
    await expect(page.getByRole('combobox', { name: 'Closest approach', exact: true })).toHaveValue(churciePlayers[1] ?? '');
    await page.getByRole('button', { name: 'Dots for Fictional golfer 2 · Churcie', exact: true }).click();
    dialog = page.getByRole('dialog', { name: 'Dots · Fictional golfer 2', exact: true });
    await expect(dialog.getByLabel('Sticky for Fictional golfer 2', { exact: true })).toBeChecked();
    await expect(dialog.getByLabel('Sandy count · Fictional golfer 2', { exact: true })).toHaveValue('1');
    await expect(dialog.getByRole('combobox', { name: 'Murphy press stage 1 · Fictional golfer 2', exact: true })).toHaveValue('1');
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
    const interrupted = fixture.counters().requests[0];
    await form.getByRole('button', { name: 'Save & Next Hole', exact: true }).click();
    await expect(page.getByRole('form', { name: 'Group 1 hole 11 entry', exact: true })).toBeVisible();
    expect(fixture.counters().requests[1]).toEqual(interrupted);
    const expectedOrder = [churciePlayers[1], churciePlayers[2], churciePlayers[3], churciePlayers[0]];
    expect(fixture.counters().requests.filter((request) => request.score.churchy !== undefined)).toHaveLength(2);
    expect(fixture.counters().requests[1]?.score.churchy).toMatchObject({
      version: 3, number: 10, rotation: { playerIds: expectedOrder },
      players: [{ playerId: churciePlayers[1], counts: { dime: 1, sandy: 1 }, calls: [{ kind: 'murphy', result: 'success', murphyPresses: 1 }] }],
    });
    const result = fixture.read().games?.results.find((entry) => entry.kind === 'churchy' && entry.churchy?.order);
    expect(result?.churchy?.order).toEqual({ playerIds: expectedOrder });
    expect(result?.churchy?.holes.find((hole) => hole.number === 10)?.specials).toEqual(expect.arrayContaining([
      expect.objectContaining({ special: 'Sandy', playerId: churciePlayers[1], dots: 1 }),
      expect.objectContaining({ special: 'Sticky', playerId: churciePlayers[1], dots: 1 }),
      expect.objectContaining({ special: 'Birdie', playerId: churciePlayers[1], dots: 2 }),
    ]));
    await savePar(page, 11);
    await savePar(page, 12);
    await page.getByRole('button', { name: 'Dots for Fictional golfer 2 · Churcie', exact: true }).click();
    await expect(page.getByRole('dialog').getByText('Partner: Fictional golfer 4 · ×1', { exact: true })).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: 'Done', exact: true }).click();
    expect(fixture.counters().pageErrors).toEqual([]);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { await fixture.close(); }
});

test('Churcie tee creation copies device presets, preserves custom units after reload and stores only specials configuration', async ({ page }, testInfo) => {
  const fixture = await openChurcieV3Fixture(page, testInfo, 'setup');
  try {
    if (testInfo.project.name !== 'desktop-chromium') {
      await page.setViewportSize({ width: 320, height: 900 });
      await page.evaluate(() => {
        document.documentElement.dataset.theme = 'dark';
        document.documentElement.style.fontSize = '125%';
      });
    }
    await page.getByRole('button', { name: 'Games', exact: true }).click();
    await page.getByRole('button', { name: 'Add game', exact: true }).click();
    let editor = page.getByRole('form', { name: 'Game settings', exact: true });
    await editor.getByRole('combobox', { name: 'Game type', exact: true }).selectOption('churchy');
    await editor.getByRole('combobox', { name: 'Churcie playing group', exact: true }).selectOption('1');
    await editor.getByRole('combobox', { name: 'Choose Churcie partners', exact: true }).selectOption('tee');
    await editor.getByRole('combobox', { name: 'Churcie P1', exact: true }).selectOption(churciePlayers[1] ?? '');
    await editor.getByText(/^Specials and presets ·/).click();
    await expect(editor.getByLabel('Eagle units', { exact: true })).toHaveValue('4');
    await expect(editor.getByRole('checkbox', { name: 'Sticky', exact: true })).toBeChecked();
    for (const select of await editor.getByRole('combobox').all()) {
      expect(await select.evaluate((element) => element instanceof HTMLSelectElement
        && element.getBoundingClientRect().height >= 44 && element.parentElement !== null
        && element.clientWidth <= element.parentElement.clientWidth)).toBe(true);
    }
    if (testInfo.project.name !== 'desktop-chromium') {
      await editor.locator('.dots-specials').screenshot({ path: testInfo.outputPath('churcie-presets-phone.png') });
      await page.screenshot({ path: testInfo.outputPath('churcie-presets-viewport.png') });
    }
    expect(await editor.locator('.dots-special-toggle').filter({ has: page.getByRole('checkbox', { name: 'Sticky', exact: true }) })
      .locator('span').evaluate((element) => {
        const range = document.createRange();
        range.selectNodeContents(element);
        return range.getClientRects().length;
      })).toBe(1);
    await editor.getByRole('combobox', { name: 'Specials preset', exact: true }).selectOption('built-in:dots-common');
    await expect(editor.getByLabel('Eagle units', { exact: true })).toHaveValue('4');
    await editor.getByRole('button', { name: 'Apply preset', exact: true }).click();
    await expect(editor.getByLabel('Eagle units', { exact: true })).toHaveValue('5');
    await editor.getByLabel('Eagle units', { exact: true }).fill('7');
    await editor.getByRole('button', { name: 'Select all', exact: true }).click();
    await expect(editor.getByLabel('Eagle units', { exact: true })).toHaveValue('7');
    for (const name of ['Assassin · Automatic', 'Sweep · Automatic', 'Other']) {
      await expect(editor.getByRole('checkbox', { name, exact: true })).toBeChecked();
    }
    await editor.getByText('Save a device preset', { exact: true }).click();
    await editor.getByLabel('Preset name', { exact: true }).fill('Fictional weekend specials');
    await editor.getByRole('button', { name: 'Save new preset', exact: true }).click();
    await expect(editor.getByText('Preset saved on this device.', { exact: true })).toBeVisible();
    await editor.getByLabel('Eagle units', { exact: true }).fill('9');
    await editor.getByRole('button', { name: 'Save game', exact: true }).click();
    await expect(page.getByText('Game settings saved.', { exact: true })).toBeVisible();
    const first = fixture.read().games?.configuration.games.find((game) => game.kind === 'churchy');
    expect(first?.version === 3 && first.orderMode).toBe('tee');
    expect(first?.playerIds).toEqual([churciePlayers[1], churciePlayers[0], churciePlayers[2], churciePlayers[3]]);
    expect(first?.version === 3 && first.specials.find((special) => special.kind === 'eagle')?.units).toBe(9);
    await page.reload();
    await page.getByRole('button', { name: 'Games', exact: true }).click();
    await page.getByRole('button', { name: 'Add game', exact: true }).click();
    editor = page.getByRole('form', { name: 'Game settings', exact: true });
    await editor.getByRole('combobox', { name: 'Game type', exact: true }).selectOption('churchy');
    await editor.getByRole('combobox', { name: 'Churcie playing group', exact: true }).selectOption('2');
    await editor.getByText(/^Specials and presets ·/).click();
    await editor.getByRole('combobox', { name: 'Specials preset', exact: true }).selectOption({ label: 'Fictional weekend specials' });
    await expect(editor.getByLabel('Eagle units', { exact: true })).toHaveValue('4');
    await editor.getByRole('button', { name: 'Apply preset', exact: true }).click();
    await expect(editor.getByLabel('Eagle units', { exact: true })).toHaveValue('7');
    await editor.getByRole('button', { name: 'Save game', exact: true }).click();
    await expect.poll(() => fixture.counters().configWrites).toBe(2);
    const saved = fixture.read().games?.configuration.games.filter((game) => game.kind === 'churchy' && game.version === 3);
    expect(saved?.map((game) => game.specials.find((special) => special.kind === 'eagle')?.units)).toEqual([9, 7]);
    const persisted = await page.evaluate((): unknown => JSON.parse(localStorage.getItem('perlygolfmax.dot-presets.v1') ?? 'null'));
    expect(persisted).toEqual({ version: 1, entries: [{
      id: 'custom-fictional weekend specials', name: 'Fictional weekend specials',
      specials: expect.arrayContaining(dotsSpecialCatalog.map((special) => ({
        kind: special.kind, units: special.kind === 'eagle' ? 7 : special.defaultUnits,
      }))),
    }] });
    expect(fixture.counters().writes).toBe(0);
    expect(fixture.counters().pageErrors).toEqual([]);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { await fixture.close(); }
});

test('Churcie deferred order remains available after another group locks setup and late saved receipts stay immutable', async ({ page }, testInfo) => {
  const fixture = await openChurcieV3Fixture(page, testInfo, 'other-group-started');
  try {
    await expect(page.getByRole('combobox', { name: 'Closest approach', exact: true })).toBeEnabled();
    await savePar(page, 10);
    await expect(page.getByRole('combobox', { name: 'Closest approach', exact: true })).toHaveCount(0);
    await page.getByRole('combobox', { name: 'Jump to hole', exact: true }).selectOption('10');
    await order(page);
    await page.getByRole('form', { name: 'Group 1 hole 10 entry', exact: true })
      .getByRole('button', { name: 'Save & Next Hole', exact: true }).click();
    await expect(page.getByRole('form', { name: 'Group 1 hole 11 entry', exact: true })).toBeVisible();
    const receipt = fixture.read().cards[0]?.holes.find((hole) => hole.number === 10)?.score.churchy;
    expect(receipt).toMatchObject({ version: 3, rotation: {
      playerIds: [churciePlayers[1], churciePlayers[2], churciePlayers[3], churciePlayers[0]], recordedLate: true,
    } });
    await page.getByText('Churcie partners · Order recorded late', { exact: true }).click();
    await expect(page.getByRole('list', { name: 'Churcie partner rotation', exact: true })).toContainText('Holes 10, 11, 12');
    await expect(page.getByRole('combobox', { name: 'Closest approach', exact: true })).toHaveCount(0);
    await page.getByRole('combobox', { name: 'Jump to hole', exact: true }).selectOption('10');
    await page.getByLabel('Fictional golfer 1 score', { exact: true }).fill('5');
    await page.getByRole('form', { name: 'Group 1 hole 10 entry', exact: true })
      .getByRole('button', { name: 'Save & Next Hole', exact: true }).click();
    await expect(page.getByRole('form', { name: 'Group 1 hole 11 entry', exact: true })).toBeVisible();
    expect(fixture.read().cards[0]?.holes.find((hole) => hole.number === 10)?.score.churchy).toEqual(receipt);
    expect(fixture.read().cards[4]?.holes.find((hole) => hole.number === 1)?.score).toEqual({ kind: 'strokes', strokes: 4 });
    expect(fixture.counters().pageErrors).toEqual([]);
  } finally { await fixture.close(); }
});

test('old Churcie capability does not expose creation or new approach-order controls', async ({ page }, testInfo) => {
  const fixture = await openChurcieV3Fixture(page, testInfo, 'old-api');
  try {
    await expect(page.getByRole('combobox', { name: 'Closest approach', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Games', exact: true }).click();
    await page.getByRole('button', { name: 'Add game', exact: true }).click();
    const editor = page.getByRole('form', { name: 'Game settings', exact: true });
    await expect(editor.getByRole('option', { name: 'Churcie', exact: true })).toHaveCount(0);
    await expect(editor.getByRole('combobox', { name: 'Choose Churcie partners', exact: true })).toHaveCount(0);
    expect(fixture.counters().writes).toBe(0);
    expect(fixture.counters().configWrites).toBe(0);
    expect(fixture.counters().pageErrors).toEqual([]);
  } finally { await fixture.close(); }
});
