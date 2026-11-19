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

test('Churchie birdie Murphy permits par Sandy/Pully, retains target on retry/reload, and follows a raw-only score correction', async ({ page }, testInfo) => {
  const fixture = await openChurcieV3Fixture(page, testInfo, 'murphy-targets');
  try {
    await page.setViewportSize({ width: 320, height: 900 });
    await page.evaluate(() => {
      document.documentElement.dataset.theme = 'dark';
      document.documentElement.style.fontSize = '125%';
    });
    await order(page);
    const form = page.getByRole('form', { name: 'Group 1 hole 10 entry', exact: true });
    await form.getByRole('button', { name: 'Dots for Fictional golfer 2 · Churchie', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Dots · Fictional golfer 2', exact: true });
    await dialog.getByRole('checkbox', { name: 'Murphy called · Fictional golfer 2', exact: true }).check();
    await expect(dialog.getByText('Pending · enter a gross score', { exact: true })).toBeVisible();
    await dialog.getByRole('checkbox', { name: 'Murphy for birdie · Fictional golfer 2', exact: true }).check();
    for (const theme of ['light', 'dark']) {
      await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
      const spacing = await dialog.locator('.murphy-call').evaluate((element) => {
        const [called, birdie] = element.querySelectorAll(':scope > label.dots-special-choice');
        if (!called || !birdie) throw new Error('Missing Murphy call or birdie choice');
        const first = called.getBoundingClientRect(), second = birdie.getBoundingClientRect();
        return { gap: second.top - first.bottom, heights: [first.height, second.height] };
      });
      expect(spacing.gap, `${theme}: Murphy and birdie controls need a visible gap`).toBeGreaterThanOrEqual(5);
      for (const height of spacing.heights) expect(height).toBeGreaterThanOrEqual(44);
    }
    const increase = dialog.getByRole('button', { name: 'Increase Murphy stakes · Fictional golfer 2', exact: true });
    await increase.click();
    await increase.click();
    await expect(increase).toBeDisabled();
    await expect(dialog.getByLabel('Murphy stakes · Fictional golfer 2', { exact: true })).toHaveText('×3');
    for (const button of await dialog.locator('.murphy-call button').all()) {
      expect(await button.evaluate((element) => element.getBoundingClientRect().height >= 44)).toBe(true);
    }
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
    await form.getByRole('button', { name: 'Par for blanks', exact: true }).click();
    await form.getByRole('button', { name: 'Dots for Fictional golfer 2 · Churchie', exact: true }).click();
    await expect(dialog.getByText('Missed · opponents earn · needs 3 or better', { exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: 'Increase Sandy for Fictional golfer 2', exact: true }).click();
    await dialog.getByRole('checkbox', { name: 'Pully for Fictional golfer 2', exact: true }).check();
    await expect(dialog.getByRole('alert')).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
    fixture.failNextAcknowledgement();
    await form.getByRole('button', { name: 'Save & Next Hole', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Service request failed (503)');
    const interrupted = fixture.counters().requests[0];
    await form.getByRole('button', { name: 'Save & Next Hole', exact: true }).click();
    await expect(page.getByRole('form', { name: 'Group 1 hole 11 entry', exact: true })).toBeVisible();
    expect(fixture.counters().requests[1]).toEqual(interrupted);
    expect(fixture.counters().writes).toBe(4);
    const canonical = fixture.read().cards[0]?.holes.find((hole) => hole.number === 10)?.score.churchy;
    expect(canonical).toMatchObject({ version: 3, players: [{
      playerId: churciePlayers[1], counts: { sandy: 1, pully: 1 },
      calls: [{ kind: 'murphy', result: 'pending', murphyTarget: 'birdie', murphyPresses: 2 }],
    }] });
    const specials = () => fixture.read().games?.results.find((game) => game.kind === 'churchy')
      ?.churchy?.holes.find((hole) => hole.number === 10)?.specials ?? [];
    expect(specials()).toEqual(expect.arrayContaining([
      expect.objectContaining({ special: 'Sandy', playerId: churciePlayers[1], dots: 1 }),
      expect.objectContaining({ special: 'Pully', playerId: churciePlayers[1], dots: 1 }),
      expect.objectContaining({ special: 'Murphy', playerId: churciePlayers[1], dots: 3,
        winners: expect.arrayContaining([churciePlayers[2], churciePlayers[3]]) }),
    ]));
    await page.reload();
    await page.getByRole('combobox', { name: 'Jump to hole', exact: true }).selectOption('10');
    await form.getByRole('button', { name: 'Dots for Fictional golfer 2 · Churchie', exact: true }).click();
    await expect(dialog.getByRole('checkbox', { name: 'Murphy for birdie · Fictional golfer 2', exact: true })).toBeChecked();
    await expect(dialog.getByLabel('Murphy stakes · Fictional golfer 2', { exact: true })).toHaveText('×3');
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
    await form.getByLabel('Fictional golfer 2 score', { exact: true }).fill('3');
    await form.getByRole('button', { name: 'Dots for Fictional golfer 2 · Churchie', exact: true }).click();
    await expect(dialog.getByText('Made · needs 3 or better', { exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
    await form.getByRole('button', { name: 'Save & Next Hole', exact: true }).click();
    await expect(page.getByRole('form', { name: 'Group 1 hole 11 entry', exact: true })).toBeVisible();
    expect(fixture.counters().writes).toBe(5);
    expect(fixture.read().cards[0]?.holes.find((hole) => hole.number === 10)?.score.churchy).toEqual(canonical);
    expect(specials()).toContainEqual(expect.objectContaining({ special: 'Murphy', dots: 3,
      winners: expect.arrayContaining([churciePlayers[0], churciePlayers[1]]) }));
    expect(fixture.counters().pageErrors).toEqual([]);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { await fixture.close(); }
});

test('Churchie cards refresh and cold-load after another scorer saves a failed Murphy with reversed opponent order', async ({ page }, testInfo) => {
  const fixture = await openChurcieV3Fixture(page, testInfo);
  try {
    await page.getByRole('button', { name: 'Scorecards', exact: true }).click();
    const cards = page.getByRole('region', { name: 'Round scorecards', exact: true });
    await cards.getByRole('button', { name: 'Back 9', exact: true }).click();
    fixture.simulateRemoteOpponentAward();
    const result = fixture.read().games?.results.find((game) => game.kind === 'churchy');
    const hole = result?.churchy?.holes.find((entry) => entry.number === 10);
    expect(hole?.specials.find((special) => special.special === 'Murphy')?.winners)
      .toEqual([churciePlayers[1], churciePlayers[2]]);
    expect(hole?.pairs).toContainEqual([churciePlayers[2], churciePlayers[1]]);
    await page.getByRole('button', { name: 'Refresh saved round', exact: true }).click();
    await expect(cards.getByLabel(/^Hole 10: 5(?:,|$)/)).toBeVisible();
    await expect(page.getByText(/Invalid owner scorecards response/)).toHaveCount(0);
    await page.reload();
    await page.getByRole('button', { name: 'Scorecards', exact: true }).click();
    await cards.getByRole('button', { name: 'Back 9', exact: true }).click();
    await expect(cards.getByLabel(/^Hole 10: 5(?:,|$)/)).toBeVisible();
    expect(fixture.counters().writes).toBe(0);
    expect(fixture.counters().requests).toHaveLength(0);
    expect(fixture.counters().pageErrors).toEqual([]);
  } finally { await fixture.close(); }
});

test('Churchie blocks failed-call combinations before saving and preserves explicit corrections and presses', async ({ page }, testInfo) => {
  const fixture = await openChurcieV3Fixture(page, testInfo);
  try {
    await page.setViewportSize({ width: 320, height: 900 });
    await page.evaluate(() => { document.documentElement.style.fontSize = '125%'; });
    await order(page);
    const form = page.getByRole('form', { name: 'Group 1 hole 10 entry', exact: true });
    await form.getByRole('button', { name: 'Par for blanks', exact: true }).click();
    await form.getByLabel('Fictional golfer 2 score', { exact: true }).fill('5');
    await page.getByRole('button', { name: 'Dots for Fictional golfer 2 · Churchie', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Dots · Fictional golfer 2', exact: true });
    await dialog.getByRole('button', { name: 'Increase Sandy for Fictional golfer 2', exact: true }).click();
    await dialog.getByRole('button', { name: 'Call Paree · Fictional golfer 2', exact: true }).click();
    const paree = dialog.getByRole('combobox', { name: 'Paree call 1 · Fictional golfer 2', exact: true });
    await expect(paree.getByRole('option', { name: 'Failed · Opponents earn', exact: true })).toHaveJSProperty('disabled', true);
    await expect(dialog.getByText(/Clear this golfer.*par-or-better specials or made calls/)).toBeVisible();
    expect(fixture.counters().requests).toHaveLength(0);
    await dialog.getByRole('button', { name: 'Decrease Sandy for Fictional golfer 2', exact: true }).click();
    await paree.selectOption('failure');
    await expect(dialog.getByRole('button', { name: 'Increase Sandy for Fictional golfer 2', exact: true })).toBeDisabled();
    await expect(dialog.getByRole('checkbox', { name: 'Pully for Fictional golfer 2', exact: true })).toBeDisabled();
    await expect(dialog.getByRole('checkbox', { name: 'Sticky for Fictional golfer 2', exact: true })).toBeDisabled();
    await dialog.getByRole('button', { name: 'Call Murphy · Fictional golfer 2', exact: true }).click();
    const murphy = dialog.getByRole('combobox', { name: 'Murphy call 1 · Fictional golfer 2', exact: true });
    await expect(murphy.getByRole('option', { name: 'Success', exact: true })).toHaveJSProperty('disabled', true);
    await murphy.selectOption('failure');
    for (const width of [320, 390, 430]) for (const font of ['100%', '125%']) for (const theme of ['light', 'dark']) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(({ theme, font }) => {
        document.documentElement.dataset.theme = theme;
        document.documentElement.style.fontSize = font;
      }, { theme, font });
      const layout = await paree.evaluate((element) => {
        const row = element.closest('.dots-call');
        const hint = row?.querySelector(':scope > small'), action = row?.querySelector(':scope > button');
        if (!row || !hint || !action) throw new Error('Missing Paree hint or remove action');
        return { gap: action.getBoundingClientRect().top - hint.getBoundingClientRect().bottom,
          fits: row.scrollWidth <= row.clientWidth };
      });
      expect(layout.gap, `${String(width)}px ${font} ${theme}: Paree removal must sit below the wrapped hint`).toBeGreaterThanOrEqual(4);
      expect(layout.fits).toBe(true);
    }
    await dialog.getByRole('combobox', { name: 'Murphy press stage 1 · Fictional golfer 2', exact: true }).selectOption('2');
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
    await form.getByRole('button', { name: 'Save & Next Hole', exact: true }).click();
    await expect(page.getByRole('form', { name: 'Group 1 hole 11 entry', exact: true })).toBeVisible();
    expect(fixture.counters().writes).toBe(4);
    const canonical = fixture.counters().requests.find((request) => request.score.churchy !== undefined)?.score.churchy;
    expect(canonical).toMatchObject({ version: 3, players: [{
      playerId: churciePlayers[1], counts: { sandy: 0 },
      calls: [{ kind: 'paree', result: 'failure' }, { kind: 'murphy', result: 'failure', murphyPresses: 2 }],
    }] });
    expect(fixture.counters().pageErrors).toEqual([]);
  } finally { await fixture.close(); }
});

test('Churchie approach order and Sticky/Sandy calls survive a failed lean acknowledgement and rotate after three played holes', async ({ page }, testInfo) => {
  const fixture = await openChurcieV3Fixture(page, testInfo);
  try {
    await order(page);
    const form = page.getByRole('form', { name: 'Group 1 hole 10 entry', exact: true });
    await form.getByRole('button', { name: 'Par for blanks', exact: true }).click();
    await form.getByLabel('Fictional golfer 2 score', { exact: true }).fill('3');
    await page.getByRole('button', { name: 'Dots for Fictional golfer 2 · Churchie', exact: true }).click();
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
    await page.getByRole('button', { name: 'Dots for Fictional golfer 2 · Churchie', exact: true }).click();
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
    await page.getByRole('button', { name: 'Dots for Fictional golfer 2 · Churchie', exact: true }).click();
    await expect(page.getByRole('dialog').getByText('Partner: Fictional golfer 4 · ×1', { exact: true })).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: 'Done', exact: true }).click();
    expect(fixture.counters().pageErrors).toEqual([]);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { await fixture.close(); }
});

test('Churchie tee creation copies device presets, preserves custom units after reload and stores only specials configuration', async ({ page }, testInfo) => {
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
    await editor.getByRole('combobox', { name: 'Churchie playing group', exact: true }).selectOption('1');
    await editor.getByRole('combobox', { name: 'Choose Churchie partners', exact: true }).selectOption('tee');
    await editor.getByRole('combobox', { name: 'Churchie P1', exact: true }).selectOption(churciePlayers[1] ?? '');
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
    await editor.getByRole('combobox', { name: 'Churchie playing group', exact: true }).selectOption('2');
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

test('Churchie deferred order remains available after another group locks setup and late saved receipts stay immutable', async ({ page }, testInfo) => {
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
    await page.getByText('Churchie partners · Order recorded late', { exact: true }).click();
    await expect(page.getByRole('list', { name: 'Churchie partner rotation', exact: true })).toContainText('Holes 10, 11, 12');
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

test('old Churchie capability does not expose creation or new approach-order controls', async ({ page }, testInfo) => {
  const fixture = await openChurcieV3Fixture(page, testInfo, 'old-api');
  try {
    await expect(page.getByRole('combobox', { name: 'Closest approach', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Games', exact: true }).click();
    await page.getByRole('button', { name: 'Add game', exact: true }).click();
    const editor = page.getByRole('form', { name: 'Game settings', exact: true });
    await expect(editor.getByRole('option', { name: 'Churchie', exact: true })).toHaveCount(0);
    await expect(editor.getByRole('combobox', { name: 'Choose Churchie partners', exact: true })).toHaveCount(0);
    expect(fixture.counters().writes).toBe(0);
    expect(fixture.counters().configWrites).toBe(0);
    expect(fixture.counters().pageErrors).toEqual([]);
  } finally { await fixture.close(); }
});
