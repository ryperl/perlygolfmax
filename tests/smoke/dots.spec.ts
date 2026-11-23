import type { Locator, Page } from '@playwright/test';
import { expect, test } from './test';
import { contrastRatio } from './contrast';
import { dotsPlayers, openDotsFixture } from './dots-fixture-data';
import { dotsSpecialCatalog } from '../../src/domain/dots';

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

async function openGameStandings(page: Page, name: string) {
  const summary = page.getByText(`${name} · Game standings`, { exact: true });
  if (!await summary.evaluate((element) => {
    const details = element.closest('details');
    if (!details) throw new Error('Missing game standings disclosure');
    return details.open;
  })) await summary.click();
}

for (const size of [3, 6] as const) {
  test(`updated ${String(size)}-hole Dots setup explains team method, SO and separate sweeps before saving`, async ({ page }, testInfo) => {
    const fixture = await openDotsFixture(page, testInfo, 'setup-v3');
    try {
      await page.setViewportSize({ width: 320, height: 900 });
      await page.getByRole('button', { name: 'Games', exact: true }).click();
      await page.getByRole('button', { name: 'Add game', exact: true }).click();
      const editor = page.getByRole('form', { name: 'Game settings', exact: true });
      await editor.getByRole('combobox', { name: 'Dots playing group', exact: true }).selectOption('1');
      await editor.getByRole('combobox', { name: 'Dots mode', exact: true }).selectOption(`rotating-${String(size)}`);
      await editor.getByRole('combobox', { name: 'Choose first teams by', exact: true }).selectOption('approach');
      await editor.getByRole('checkbox', { name: 'Net High/Low', exact: true }).check();
      await editor.getByRole('combobox', { name: 'High/Low net strokes', exact: true }).selectOption('group-low-v1');
      await editor.getByText('Choose special dots (0)', { exact: true }).click();
      await editor.getByRole('checkbox', { name: 'Manual Sweep', exact: true }).check();
      await expect(editor.getByText(/High 1 \+ Low 1 \+ Sweep 1 = 3 each/)).toBeVisible();
      await expect(editor.getByText(/Manual Sweep is a separate agreed bonus/)).toBeVisible();
      await expect(editor.getByRole('region', { name: 'Review Dots setup', exact: true })).toContainText(`every ${String(size)} played holes`);
      await expect(editor.getByRole('combobox', { name: 'Closest approach', exact: true })).toHaveCount(0);
      await narrowControls(page, editor);
      await editor.getByRole('button', { name: 'Save game', exact: true }).click();
      await expect(page.getByText('Game settings saved.', { exact: true })).toBeVisible();
      expect(fixture.counters().configurations[0]?.find((game) => game.kind === 'dots')).toMatchObject({
        version: 3, orderMode: 'approach', rotationHoles: size,
        highLow: { version: 2, handicapRule: 'group-low-v1' }, sweepRule: 'manual-v1',
      });
      await page.getByRole('button', { name: 'Enter scores', exact: true }).click();
      await expect(page.getByRole('combobox', { name: 'Closest approach', exact: true })).toBeVisible();
      expect(fixture.counters().writes).toBe(0);
      expect(fixture.counters().pageErrors).toEqual([]);
    } finally { await fixture.close(); }
  });
}

for (const scenario of ['rotating-v3-tee', 'rotating-v3-approach', 'rotating-v3-six'] as const) {
  test(`${scenario} acknowledges first-hole order and automatic High/Low Sweep without manual entry`, async ({ page }, testInfo) => {
    const fixture = await openDotsFixture(page, testInfo, scenario);
    try {
      await page.setViewportSize({ width: 390, height: 900 });
      const form = page.getByRole('form', { name: 'Group 1 hole 4 entry', exact: true });
      const approach = scenario === 'rotating-v3-approach';
      const labels = approach ? ['Closest approach', 'Next closest approach', 'Next farthest approach', 'Farthest approach'] as const
        : ['First in tee flip', 'Second in tee flip', 'Third in tee flip', 'Fourth in tee flip'] as const;
      for (const [index, label] of labels.entries()) {
        const choice = form.getByRole('combobox', { name: label, exact: true });
        await choice.selectOption(dotsPlayers[index] ?? '');
        expect((await choice.boundingBox())?.height).toBeGreaterThanOrEqual(44);
      }
      const winners = approach ? [dotsPlayers[0], dotsPlayers[3]] : dotsPlayers.slice(0, 2);
      for (const [index, id] of dotsPlayers.entries()) {
        await form.getByLabel(`Fictional golfer ${String(index + 1)} score`, { exact: true }).fill(winners.includes(id) ? '3' : '5');
      }
      await expect(form.getByText('Preview · Receives 0 strokes · Net 3')).toHaveCount(2);
      await expect(form.getByRole('region', { name: 'Fictional updated Dots net comparison', exact: true })).toContainText('Preview High/Low');
      await expect(form.getByRole('region', { name: 'Fictional updated Dots net comparison', exact: true })).toContainText('Automatic High/Low Sweep');
      expect(fixture.counters().writes).toBe(0);
      await form.getByRole('button', { name: 'Save & Next Hole', exact: true }).click();
      await expect(page.getByRole('form', { name: 'Group 1 hole 5 entry', exact: true })).toBeVisible();
      const result = fixture.read().games?.results.find((game) => game.kind === 'dots');
      expect(result?.players.map((player) => player.totalPoints)).toEqual(approach ? [3, 0, 0, 3] : [3, 3, 0, 0]);
      expect(result?.dots?.players.map((player) => player.totalPoints)).toEqual([0, 0, 0, 0]);
      expect(result?.dotsHighLow?.awards.filter((award) => award.kind === 'high-low-sweep')).toHaveLength(1);
      await page.getByRole('combobox', { name: 'Jump to hole', exact: true }).selectOption(scenario === 'rotating-v3-six' ? '1' : '7');
      await expect(page.getByText('Saved teams · Fictional golfer 1 + Fictional golfer 3 vs Fictional golfer 2 + Fictional golfer 4', { exact: true })).toBeVisible();
      await expect(page.getByRole('combobox', { name: labels[0], exact: true })).toHaveCount(0);
      expect(fixture.counters().writes).toBe(4);
      expect(fixture.counters().pageErrors).toEqual([]);
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    } finally { await fixture.close(); }
  });
}

test('Pully Murphy uses an explicit touch checkbox and saved personal gross score, retaining the call through raw correction', async ({ page }, testInfo) => {
  const fixture = await openDotsFixture(page, testInfo, 'pully-targets');
  try {
    await page.setViewportSize({ width: 390, height: 900 });
    const form = page.getByRole('form', { name: 'Group 1 hole 1 entry', exact: true });
    for (const input of await form.locator('input[inputmode="numeric"]').all()) await input.fill('4');
    await form.getByRole('button', { name: 'Dots for Fictional golfer 1 · Fictional current Dots', exact: true }).click();
    const dialog = form.getByRole('dialog');
    const called = dialog.getByRole('checkbox', { name: 'Pully Murphy called · Fictional golfer 1', exact: true });
    await called.focus();
    await called.press('Space');
    await expect(called).toBeChecked();
    await expect(called).toBeFocused();
    expect(await called.evaluate((element) => element.closest('label')?.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
    await expect(dialog.getByText('Made · needs exact gross par 4', { exact: true })).toBeVisible();
    await expect(dialog.getByRole('combobox')).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
    await form.getByRole('button', { name: 'Save & Next Hole', exact: true }).click();
    await expect(page.getByRole('form', { name: 'Group 1 hole 2 entry', exact: true })).toBeVisible();
    const first = fixture.read().cards[0]?.holes[0]?.score.dots?.[0]?.players[0]?.calls[0];
    expect(first).toMatchObject({ kind: 'pully-murphy', result: 'pending', pullyMurphyTarget: 'par' });
    await page.getByRole('button', { name: 'Previous hole', exact: true }).click();
    await form.locator('input[inputmode="numeric"]').first().fill('5');
    await form.getByRole('button', { name: 'Save & Next Hole', exact: true }).click();
    await expect(page.getByRole('form', { name: 'Group 1 hole 2 entry', exact: true })).toBeVisible();
    expect(fixture.read().cards[0]?.holes[0]?.score.dots?.[0]?.players[0]?.calls).toEqual([first]);
    expect(fixture.read().games?.results[0]?.dots?.awards.map((award) => award.recipientIds))
      .toEqual([[...dotsPlayers.slice(1)]]);
    expect(fixture.counters().pageErrors).toEqual([]);
  } finally { await fixture.close(); }
});

test('same-source dot choices reject Chippy/Pully and Seve/KP/Long Drive while allowing Seve/Blue Plate/Gorilla', async ({ page }, testInfo) => {
  const fixture = await openDotsFixture(page, testInfo, 'coexistence');
  try {
    await page.setViewportSize({ width: 320, height: 900 });
    const form = page.getByRole('form', { name: 'Group 1 hole 1 entry', exact: true });
    await form.getByRole('button', { name: 'Par for blanks', exact: true }).click();
    await form.getByRole('button', { name: 'Dots for Fictional golfer 1 · Fictional current Dots', exact: true }).click();
    const dialog = form.getByRole('dialog', { name: 'Dots · Fictional golfer 1', exact: true });
    await dialog.getByRole('checkbox', { name: 'Chippy for Fictional golfer 1', exact: true }).check();
    await expect(dialog.getByRole('checkbox', { name: 'Pully for Fictional golfer 1', exact: true })).toBeDisabled();
    await dialog.getByRole('checkbox', { name: 'Chippy for Fictional golfer 1', exact: true }).uncheck();
    await dialog.getByRole('checkbox', { name: 'Seve for Fictional golfer 1', exact: true }).check();
    await expect(dialog.getByRole('checkbox', { name: 'Gorilla for Fictional golfer 1', exact: true })).toBeEnabled();
    await dialog.getByRole('checkbox', { name: 'Gorilla for Fictional golfer 1', exact: true }).check();
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(form.getByRole('combobox', { name: 'Long Drive result', exact: true }).locator(`option[value="${dotsPlayers[0] ?? ''}"]`)).toHaveJSProperty('disabled', true);
    await expect(form.getByRole('combobox', { name: 'Blue Plate result', exact: true }).locator(`option[value="${dotsPlayers[0] ?? ''}"]`)).toHaveJSProperty('disabled', false);
    await form.getByRole('combobox', { name: 'Blue Plate result', exact: true }).selectOption(dotsPlayers[0] ?? '');
    await form.getByRole('combobox', { name: 'Long Drive result', exact: true }).selectOption(dotsPlayers[1] ?? '');
    await form.getByRole('button', { name: 'Save & Next Hole', exact: true }).click();
    const second = page.getByRole('form', { name: 'Group 1 hole 2 entry', exact: true });
    await expect(second).toBeVisible();
    const result = fixture.read().games?.results.find((game) => game.kind === 'dots')?.dots;
    expect(result?.awards.filter((award) => award.earnedBy === dotsPlayers[0]).map((award) => award.kind))
      .toEqual(expect.arrayContaining(['seve', 'gorilla', 'blue-plate']));
    await second.getByRole('button', { name: 'Par for blanks', exact: true }).click();
    await second.getByRole('button', { name: 'Dots for Fictional golfer 1 · Fictional current Dots', exact: true }).click();
    const nextDialog = second.getByRole('dialog', { name: 'Dots · Fictional golfer 1', exact: true });
    await nextDialog.getByRole('checkbox', { name: 'Seve for Fictional golfer 1', exact: true }).check();
    await nextDialog.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(second.getByRole('combobox', { name: 'KP result', exact: true }).locator(`option[value="${dotsPlayers[0] ?? ''}"]`)).toHaveJSProperty('disabled', true);
    await second.getByRole('button', { name: 'Dots for Fictional golfer 1 · Fictional current Dots', exact: true }).click();
    await nextDialog.getByRole('checkbox', { name: 'Seve for Fictional golfer 1', exact: true }).uncheck();
    await nextDialog.getByRole('button', { name: 'Increase Sandy for Fictional golfer 1', exact: true }).click();
    await nextDialog.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(second.getByRole('combobox', { name: 'KP result', exact: true }).locator(`option[value="${dotsPlayers[0] ?? ''}"]`)).toHaveJSProperty('disabled', true);
    await second.getByRole('button', { name: 'Dots for Fictional golfer 1 · Fictional current Dots', exact: true }).click();
    await nextDialog.getByRole('button', { name: 'Decrease Sandy for Fictional golfer 1', exact: true }).click();
    await nextDialog.getByRole('button', { name: 'Done', exact: true }).click();
    await second.getByRole('combobox', { name: 'KP result', exact: true }).selectOption(dotsPlayers[0] ?? '');
    await second.getByRole('button', { name: 'Dots for Fictional golfer 1 · Fictional current Dots', exact: true }).click();
    await expect(nextDialog.getByRole('button', { name: 'Increase Sandy for Fictional golfer 1', exact: true })).toBeDisabled();
    await nextDialog.getByRole('button', { name: 'Done', exact: true }).click();
    expect(fixture.counters().writes).toBe(4);
    expect(fixture.counters().pageErrors).toEqual([]);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { await fixture.close(); }
});

test('a changed score cannot leave its saved Hogan invalid and partial-save repair retains the intended hole', async ({ page }, testInfo) => {
  const fixture = await openDotsFixture(page, testInfo, 'coexistence');
  try {
    const form = page.getByRole('form', { name: 'Group 1 hole 1 entry', exact: true });
    await form.getByRole('button', { name: 'Par for blanks', exact: true }).click();
    await form.getByRole('button', { name: 'Dots for Fictional golfer 1 · Fictional current Dots', exact: true }).click();
    const dialog = form.getByRole('dialog', { name: 'Dots · Fictional golfer 1', exact: true });
    await dialog.getByRole('checkbox', { name: 'Hogan for Fictional golfer 1', exact: true }).check();
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
    await form.getByRole('combobox', { name: 'Blue Plate result', exact: true }).selectOption('none');
    await form.getByRole('combobox', { name: 'Long Drive result', exact: true }).selectOption('none');
    await form.getByRole('button', { name: 'Save & Next Hole', exact: true }).click();
    await expect(page.getByRole('form', { name: 'Group 1 hole 2 entry', exact: true })).toBeVisible();
    await page.getByRole('combobox', { name: 'Jump to hole', exact: true }).selectOption('1');
    await form.getByLabel('Fictional golfer 1 score', { exact: true }).fill('6');
    await form.getByRole('button', { name: 'Dots for Fictional golfer 1 · Fictional current Dots', exact: true }).click();
    await expect(dialog.getByRole('checkbox', { name: 'Hogan for Fictional golfer 1', exact: true })).toBeChecked();
    await expect(dialog.getByRole('checkbox', { name: 'Hogan for Fictional golfer 1', exact: true })).toBeEnabled();
    await expect(dialog.getByRole('checkbox', { name: 'Pully for Fictional golfer 1', exact: true })).toBeDisabled();
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
    await form.getByRole('button', { name: 'Save & Next Hole', exact: true }).click();
    await expect(page.getByText(/Review all entries|Check every intended entry|Nothing sent/).first()).toBeVisible();
    expect(fixture.counters().writes).toBe(4);
    await expect(form).toBeVisible();
    await form.getByRole('button', { name: 'Dots for Fictional golfer 1 · Fictional current Dots', exact: true }).click();
    await dialog.getByRole('checkbox', { name: 'Hogan for Fictional golfer 1', exact: true }).uncheck();
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
    await form.getByRole('button', { name: 'Save & Next Hole', exact: true }).click();
    await expect(page.getByRole('form', { name: 'Group 1 hole 2 entry', exact: true })).toBeVisible();
    expect(fixture.counters().writes).toBe(5);
    expect(fixture.read().games?.results.find((game) => game.kind === 'dots')?.dots?.issues).toEqual([]);
    expect(fixture.counters().pageErrors).toEqual([]);
  } finally { await fixture.close(); }
});

test('Dots common selects all available specials and a standalone manual Sweep without resetting custom units', async ({ page }, testInfo) => {
  const fixture = await openDotsFixture(page, testInfo, 'setup-sweep');
  try {
    await page.setViewportSize({ width: 320, height: 900 });
    await page.getByRole('button', { name: 'Games', exact: true }).click();
    await page.getByRole('button', { name: 'Add game', exact: true }).click();
    const form = page.getByRole('form', { name: 'Game settings', exact: true });
    await expect(form.getByRole('combobox', { name: 'Dots playing group', exact: true })).toHaveValue('1');
    await form.getByLabel('Sandy', { exact: true }).check();
    await form.getByLabel('Sandy units', { exact: true }).fill('3');
    await form.getByRole('combobox', { name: 'Specials preset', exact: true }).selectOption('built-in:dots-common');
    await form.getByRole('button', { name: 'Apply preset', exact: true }).click();
    const specials = form.getByRole('group', { name: 'Enabled specials and whole-dot units', exact: true });
    for (const checkbox of await specials.getByRole('checkbox').all()) {
      if (await checkbox.isEnabled()) await expect(checkbox).toBeChecked();
    }
    await expect(form.getByLabel('Manual Sweep', { exact: true })).toBeChecked();
    await expect(form.getByLabel('Sweep · Automatic', { exact: true })).toHaveCount(0);
    await expect(form.getByLabel('Assassin · Automatic', { exact: true })).not.toBeChecked();
    await expect(form.getByLabel('Sandy units', { exact: true })).toHaveValue('3');
    await form.getByRole('button', { name: 'Save game', exact: true }).click();
    await expect(page.getByText('Game settings saved.', { exact: true })).toBeVisible();
    const game = fixture.counters().configurations[0]?.find((game) => game.kind === 'dots');
    expect(game).toMatchObject({ mode: 'individual', sweepRule: 'manual-v1' });
    if (game?.kind !== 'dots') throw new Error('Missing fictional common Dots');
    expect(game.specials).toHaveLength(dotsSpecialCatalog.length - 1);
    expect(game.specials).toContainEqual({ kind: 'sandy', units: 3 });
    expect(fixture.counters().writes).toBe(0);
    expect(fixture.counters().pageErrors).toEqual([]);
  } finally { await fixture.close(); }
});

test('manual Sweep stays independent of High/Low through save retries and raw-score corrections', async ({ page }, testInfo) => {
  const fixture = await openDotsFixture(page, testInfo, 'manual-sweep');
  try {
    await page.setViewportSize({ width: 320, height: 900 });
    const form = page.getByRole('form', { name: 'Group 1 hole 1 entry', exact: true });
    await form.getByRole('button', { name: 'Par for blanks', exact: true }).click();
    const open = () => form.getByRole('button', { name: 'Dots for Fictional golfer 2 · Fictional current Dots', exact: true }).click();
    await open();
    const dialog = page.getByRole('dialog', { name: 'Dots · Fictional golfer 2', exact: true });
    await dialog.getByRole('checkbox', { name: 'Manual Sweep for Fictional golfer 2', exact: true }).check();
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
    fixture.pauseNextFailure();
    await form.getByRole('button', { name: 'Save & Next Hole', exact: true }).click();
    await expect.poll(() => fixture.counters().requests.length).toBe(1);
    fixture.releaseFailure();
    await expect(form.getByRole('button', { name: 'Save & Next Hole', exact: true })).toBeEnabled();
    await open();
    await expect(dialog.getByRole('checkbox', { name: 'Manual Sweep for Fictional golfer 2', exact: true })).toBeChecked();
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
    await form.getByRole('button', { name: 'Save & Next Hole', exact: true }).click();
    await expect(page.getByRole('form', { name: 'Group 1 hole 2 entry', exact: true })).toBeVisible();
    expect(fixture.counters().requests[1]).toEqual(fixture.counters().requests[0]);
    const result = () => fixture.read().games?.results.find((game) => game.kind === 'dots');
    expect(result()?.players.map((player) => player.totalPoints)).toEqual([0, 2, 0, 0]);
    const saved = fixture.read().cards[0]?.holes[0]?.score.dots;
    await page.getByRole('combobox', { name: 'Jump to hole', exact: true }).selectOption('1');
    await form.getByLabel('Fictional golfer 2 score', { exact: true }).fill('5');
    await form.getByRole('button', { name: 'Save & Next Hole', exact: true }).click();
    await expect(page.getByRole('form', { name: 'Group 1 hole 2 entry', exact: true })).toBeVisible();
    expect(result()?.players.map((player) => player.totalPoints)).toEqual([0, 2, 0, 0]);
    expect(fixture.read().cards[0]?.holes[0]?.score.dots).toEqual(saved);
    expect(fixture.counters().writes).toBe(5);
    expect(fixture.counters().pageErrors).toEqual([]);
  } finally { await fixture.close(); }
});

test('Wolf High/Low Sweep is opt-in and gives one extra dot to each winning teammate', async ({ page }, testInfo) => {
  const fixture = await openDotsFixture(page, testInfo, 'setup-sweep');
  try {
    await page.getByRole('button', { name: 'Games', exact: true }).click();
    await page.getByRole('button', { name: 'Add game', exact: true }).click();
    const form = page.getByRole('form', { name: 'Game settings', exact: true });
    await form.getByRole('combobox', { name: 'Game type', exact: true }).selectOption('wolf');
    const sweep = form.getByLabel('High/Low Sweep · +1 dot per winning teammate', { exact: true });
    await expect(sweep).not.toBeChecked();
    await sweep.check();
    await form.getByRole('button', { name: 'Save game', exact: true }).click();
    await expect(page.getByText('Game settings saved.', { exact: true })).toBeVisible();
    expect(fixture.counters().configurations[0]?.find((game) => game.kind === 'wolf')).toMatchObject({ version: 2, highLowSweep: true });
    const wolfId = dotsPlayers[0];
    const partnerId = dotsPlayers.find((id) => id !== wolfId);
    if (!wolfId || !partnerId) throw new Error('Missing fictional winning side');
    const winning = new Set([wolfId, partnerId]);
    await page.getByRole('button', { name: 'Enter scores', exact: true }).click();
    const entry = page.getByRole('form', { name: 'Group 1 hole 1 entry', exact: true });
    for (const [index, label] of ['First Wolf', 'Second Wolf', 'Third Wolf', 'Fourth Wolf'].entries()) {
      await entry.getByRole('combobox', { name: label, exact: true }).selectOption(dotsPlayers[index] ?? '');
    }
    await entry.getByRole('combobox', { name: 'Wolf declaration', exact: true }).selectOption(`partner:${partnerId}`);
    for (const [index, playerId] of dotsPlayers.entries()) await entry.getByLabel(`Fictional golfer ${String(index + 1)} score`, { exact: true }).fill(winning.has(playerId) ? '3' : '4');
    await entry.getByRole('button', { name: 'Save & Next Hole', exact: true }).click();
    await expect(page.getByRole('form', { name: 'Group 1 hole 2 entry', exact: true })).toBeVisible();
    const players = fixture.read().games?.results.find((game) => game.kind === 'wolf')?.players;
    expect(players).toHaveLength(4);
    expect(players?.map((player) => player.totalPoints)).toEqual(players?.map((player) => winning.has(player.playerId) ? 3 : 0));
    expect(fixture.counters().pageErrors).toEqual([]);
  } finally { await fixture.close(); }
});

test('existing Dots automatically shares one category sweep, removes split-partner bonuses and retains failed correction drafts', async ({ page }, testInfo) => {
  const fixture = await openDotsFixture(page, testInfo, 'category-sweeps');
  try {
    await page.setViewportSize({ width: 320, height: 900 });
    const result = () => fixture.read().games?.results.find((game) => game.kind === 'dots');
    expect(result()?.players.map((player) => player.totalPoints)).toEqual([3, 3, 0, 0]);
    expect(result()?.dots?.awards.filter((award) => award.kind === 'category-sweep'))
      .toEqual([expect.objectContaining({ dots: 1, earnedBy: dotsPlayers[0], recipientIds: dotsPlayers.slice(0, 2) })]);
    const original = fixture.read().cards.map((card) => card.holes.map((hole) => hole.score.kind));
    const form = page.getByRole('form', { name: 'Group 1 hole 1 entry', exact: true });
    await expect(form.getByRole('combobox', { name: 'Long Drive result', exact: true })).toHaveValue(dotsPlayers[0] ?? '');
    await form.getByRole('combobox', { name: 'Blue Plate result', exact: true }).selectOption(dotsPlayers[1] ?? '');
    fixture.pauseNextFailure();
    await form.getByRole('button', { name: 'Save & Next Hole', exact: true }).click();
    await expect.poll(() => fixture.counters().requests.length).toBe(1);
    fixture.releaseFailure();
    await expect(form.getByRole('button', { name: 'Save & Next Hole', exact: true })).toBeEnabled();
    await expect(form.getByRole('combobox', { name: 'Blue Plate result', exact: true })).toHaveValue(dotsPlayers[1] ?? '');
    expect(result()?.players.slice(0, 2).map((player) => player.totalPoints)).toEqual([3, 3]);
    await form.getByRole('button', { name: 'Save & Next Hole', exact: true }).click();
    await expect(page.getByRole('form', { name: 'Group 1 hole 2 entry', exact: true })).toBeVisible();
    expect(fixture.counters().requests[1]).toEqual(fixture.counters().requests[0]);
    expect(fixture.counters().writes).toBe(1);
    expect(result()?.players.slice(0, 2).map((player) => player.totalPoints)).toEqual([2, 2]);
    expect(result()?.dots?.awards.some((award) => award.kind === 'category-sweep')).toBe(false);
    expect(fixture.read().cards.map((card) => card.holes.map((hole) => hole.score.kind))).toEqual(original);
    await page.reload();
    await page.getByRole('button', { name: 'Games', exact: true }).click();
    await openGameStandings(page, 'Fictional current Dots');
    const ledger = page.getByRole('region', { name: 'Fictional current Dots results', exact: true });
    await expect(ledger.getByRole('row').filter({ has: page.getByRole('rowheader', { name: 'Fictional golfer 1', exact: true }) })
      .getByRole('cell').first()).toHaveText('2');
    expect(fixture.counters().pageErrors).toEqual([]);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { await fixture.close(); }
});

test('existing Dots cards recalculate inclusive String and exclusive Birdie String, including later corrections', async ({ page }, testInfo) => {
  const fixture = await openDotsFixture(page, testInfo, 'string-rules');
  try {
    await page.setViewportSize({ width: 320, height: 900 });
    const result = () => fixture.read().games?.results.find((game) => game.kind === 'dots');
    const third = result()?.dots?.holes.find((hole) => hole.number === 3);
    expect(third?.awards.filter((award) => award.earnedBy === dotsPlayers[0]).map((award) => award.kind)).toEqual(['string']);
    expect(third?.awards.filter((award) => award.earnedBy === dotsPlayers[1]).map((award) => award.kind))
      .toEqual(['eagle', 'birdy-string']);
    await page.getByRole('button', { name: 'Games', exact: true }).click();
    await openGameStandings(page, 'Fictional current Dots');
    const ledger = page.getByRole('region', { name: 'Fictional current Dots results', exact: true });
    const points = (name: string) => ledger.getByRole('row').filter({
      has: page.getByRole('rowheader', { name, exact: true }),
    }).getByRole('cell').first();
    await expect(points('Fictional golfer 1')).toHaveText('3');
    await expect(points('Fictional golfer 2')).toHaveText('11');
    await page.getByRole('button', { name: 'Enter scores', exact: true }).click();
    await page.getByRole('combobox', { name: 'Jump to hole', exact: true }).selectOption('4');
    const fourth = page.getByRole('form', { name: 'Group 1 hole 4 entry', exact: true });
    await fourth.getByRole('button', { name: 'Par for blanks', exact: true }).click();
    await fourth.getByRole('button', { name: 'Save & Next Hole', exact: true }).click();
    await expect(page.getByRole('form', { name: 'Group 1 hole 5 entry', exact: true })).toBeVisible();
    expect(result()?.players.slice(0, 2).map((player) => player.totalPoints)).toEqual([4, 12]);
    expect(result()?.dots?.holes.find((hole) => hole.number === 4)?.awards
      .filter((award) => award.earnedBy === dotsPlayers[1]).map((award) => award.kind)).toEqual(['string']);
    await page.getByRole('combobox', { name: 'Jump to hole', exact: true }).selectOption('2');
    const correction = page.getByRole('form', { name: 'Group 1 hole 2 entry', exact: true });
    await correction.getByLabel('Fictional golfer 1 score', { exact: true }).fill('6');
    await correction.getByRole('button', { name: 'Save & Next Hole', exact: true }).click();
    await expect(page.getByRole('form', { name: 'Group 1 hole 3 entry', exact: true })).toBeVisible();
    expect(result()?.players.slice(0, 2).map((player) => player.totalPoints)).toEqual([0, 12]);
    expect(fixture.counters().writes).toBe(5);
    await page.getByRole('button', { name: 'Games', exact: true }).click();
    await openGameStandings(page, 'Fictional current Dots');
    await expect(points('Fictional golfer 1')).toHaveText('0');
    expect(fixture.counters().pageErrors).toEqual([]);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { await fixture.close(); }
});

test('ordinary Dots shares called Paree/Murphy UX, birdie targets and presses without extra declaration saves', async ({ page }, testInfo) => {
  const fixture = await openDotsFixture(page, testInfo, 'called-targets');
  try {
    await page.setViewportSize({ width: 320, height: 900 });
    const form = page.getByRole('form', { name: 'Group 1 hole 1 entry', exact: true });
    await form.getByRole('button', { name: 'Par for blanks', exact: true }).click();
    const open = () => form.getByRole('button', { name: 'Dots for Fictional golfer 2 · Fictional current Dots', exact: true }).click();
    await open();
    const dialog = page.getByRole('dialog', { name: 'Dots · Fictional golfer 2', exact: true });
    await dialog.getByRole('checkbox', { name: 'Murphy called · Fictional golfer 2', exact: true }).check();
    await dialog.getByRole('checkbox', { name: 'Murphy for birdie · Fictional golfer 2', exact: true }).check();
    const increase = dialog.getByRole('button', { name: 'Increase Murphy stakes · Fictional golfer 2', exact: true });
    await increase.click(); await increase.click(); await expect(increase).toBeDisabled();
    await dialog.getByRole('checkbox', { name: 'Paree called · Fictional golfer 2', exact: true }).check();
    await dialog.getByRole('button', { name: 'Increase Sandy for Fictional golfer 2', exact: true }).click();
    await dialog.getByRole('checkbox', { name: 'Pully for Fictional golfer 2', exact: true }).check();
    await expect(dialog.getByRole('alert')).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
    fixture.pauseNextFailure();
    await form.getByRole('button', { name: 'Save & Next Hole', exact: true }).click();
    await expect.poll(() => fixture.counters().requests.length).toBe(1);
    await expect(form.getByRole('button', { name: 'Save & Next Hole', exact: true })).toBeDisabled();
    fixture.releaseFailure();
    await expect(form.getByRole('button', { name: 'Save & Next Hole', exact: true })).toBeEnabled();
    expect(fixture.counters().writes).toBe(0);
    await open();
    await expect(dialog.getByRole('checkbox', { name: 'Murphy for birdie · Fictional golfer 2', exact: true })).toBeChecked();
    await expect(dialog.getByLabel('Murphy stakes · Fictional golfer 2', { exact: true })).toHaveText('×3');
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
    await form.getByRole('button', { name: 'Save & Next Hole', exact: true }).click();
    await expect(page.getByRole('form', { name: 'Group 1 hole 2 entry', exact: true })).toBeVisible();
    expect(fixture.counters().requests[1]).toEqual(fixture.counters().requests[0]);
    const result = () => fixture.read().games?.results.find((game) => game.kind === 'dots');
    expect(result()?.players.map((player) => player.totalPoints)).toEqual([3, 3, 3, 3]);
    const canonical = fixture.read().cards[0]?.holes.find((hole) => hole.number === 1)?.score.dots;
    expect(canonical?.[0]?.players[0]?.calls).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'murphy', result: 'pending', murphyTarget: 'birdie', murphyPresses: 2 }),
      expect.objectContaining({ kind: 'paree', result: 'pending', pareeTarget: 'par' }),
    ]));
    await page.reload();
    await page.getByRole('combobox', { name: 'Jump to hole', exact: true }).selectOption('1');
    await open();
    await expect(dialog.getByRole('checkbox', { name: 'Paree called · Fictional golfer 2', exact: true })).toBeChecked();
    await expect(dialog.getByLabel('Murphy stakes · Fictional golfer 2', { exact: true })).toHaveText('×3');
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
    await form.getByLabel('Fictional golfer 2 score', { exact: true }).fill('3');
    await form.getByRole('button', { name: 'Save & Next Hole', exact: true }).click();
    await expect(page.getByRole('form', { name: 'Group 1 hole 2 entry', exact: true })).toBeVisible();
    expect(result()?.players.map((player) => player.totalPoints)).toEqual([0, 6, 0, 0]);
    expect(fixture.read().cards[0]?.holes.find((hole) => hole.number === 1)?.score.dots).toEqual(canonical);
    expect(fixture.counters().writes).toBe(5);
    expect(fixture.counters().pageErrors).toEqual([]);
  } finally { await fixture.close(); }
});

for (const count of [1, 2, 3] as const) {
  test(`individual Dots saves and scores ${String(count)} players without teams or imaginary opponents`, async ({ page }, testInfo) => {
    const scenario = count === 1 ? 'individual-1' : count === 2 ? 'individual-2' : 'individual-3';
    const fixture = await openDotsFixture(page, testInfo, scenario);
    try {
      await page.setViewportSize({ width: 320, height: 900 });
      await page.getByRole('button', { name: 'Games', exact: true }).click();
      await page.getByRole('button', { name: 'Add game', exact: true }).click();
      const editor = page.getByRole('form', { name: 'Game settings', exact: true });
      await editor.getByRole('combobox', { name: 'Dots playing group', exact: true }).selectOption('1');
      await expect(editor.getByRole('combobox', { name: 'Dots mode', exact: true })).toHaveValue('individual');
      await expect(editor.getByRole('option', { name: 'Fixed partners', exact: true })).toHaveJSProperty('disabled', true);
      await expect(editor.getByRole('option', { name: 'Link to earned Wolf', exact: true })).toHaveJSProperty('disabled', true);
      await editor.getByLabel('Sandy', { exact: true }).check();
      if (count === 1) {
        await expect(editor.getByLabel('USD per dot difference', { exact: true })).toHaveCount(0);
        await expect(editor).toContainText('Solo stats only');
      } else {
        await editor.getByLabel('USD per dot difference', { exact: true }).fill('.50');
      }
      await editor.getByRole('button', { name: 'Save game', exact: true }).click();
      await expect(page.getByText('Game settings saved.', { exact: true })).toBeVisible();
      expect(fixture.counters().configurations[0]?.find((game) => game.kind === 'dots')).toMatchObject({
        mode: 'individual', playerIds: dotsPlayers.slice(0, count), stakeMinor: count === 1 ? null : 50,
      });
      await page.getByRole('button', { name: 'Enter scores', exact: true }).click();
      const form = page.getByRole('form', { name: 'Group 1 hole 1 entry', exact: true });
      await form.getByRole('button', { name: 'Par for blanks', exact: true }).click();
      await form.getByRole('button', { name: 'Dots for Fictional golfer 1 · Dots', exact: true }).click();
      const dialog = form.getByRole('dialog', { name: 'Dots · Fictional golfer 1', exact: true });
      await dialog.getByRole('button', { name: 'Increase Sandy for Fictional golfer 1', exact: true }).click();
      await dialog.getByRole('button', { name: 'Done', exact: true }).click();
      await form.getByRole('button', { name: 'Save & Next Hole', exact: true }).click();
      await expect(page.getByRole('form', { name: 'Group 1 hole 2 entry', exact: true })).toBeVisible();
      expect(fixture.counters().writes).toBe(count);
      const result = fixture.read().games?.results.find((game) => game.kind === 'dots');
      expect(result?.players.map((player) => player.totalPoints)).toEqual([1, ...Array.from({ length: count - 1 }, () => 0)]);
      await page.getByRole('button', { name: 'Games', exact: true }).click();
      const settlement = page.getByRole('region', { name: 'Group 1 Dots internal settlement', exact: true });
      await expect(settlement.locator('.internal-settlement-list > li')).toHaveCount(count);
      if (count === 1) {
        await expect(settlement).toContainText('Solo stats only · No money');
        await expect(settlement.getByText('Rate and settlement method', { exact: true })).toHaveCount(0);
      } else {
        await expect(settlement.locator('.internal-settlement-list > li').first().locator('summary'))
          .toContainText(count === 2 ? 'Due USD 0.50' : 'Due USD 1.00');
      }
      for (const theme of ['light', 'dark']) {
        await page.evaluate((value) => { document.documentElement.dataset.theme = value; document.documentElement.style.fontSize = '125%'; }, theme);
        await narrowControls(page, settlement);
      }
      expect(fixture.counters().pageErrors).toEqual([]);
    } finally { await fixture.close(); }
  });
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

test('Modified Sixes explicitly selects SO for net High/Low while keeping touch setup and gross specials', async ({ page }, testInfo) => {
  const fixture = await openDotsFixture(page, testInfo, 'setup-high-low');
  try {
    await page.setViewportSize({ width: 320, height: 900 });
    await page.getByRole('button', { name: 'Games', exact: true }).click();
    await page.getByRole('button', { name: 'Add game', exact: true }).click();
    const editor = page.getByRole('form', { name: 'Game settings', exact: true });
    await editor.getByRole('combobox', { name: 'Dots playing group', exact: true }).selectOption('1');
    await editor.getByRole('combobox', { name: 'Dots mode', exact: true }).selectOption('rotating-3');
    const enabled = editor.getByRole('checkbox', { name: 'Net High/Low', exact: true });
    await enabled.focus();
    await enabled.press('Space');
    await expect(enabled).toBeChecked();
    await expect(enabled).toBeFocused();
    const handicap = editor.getByRole('combobox', { name: 'High/Low net strokes', exact: true });
    await expect(handicap).toHaveValue('full-course-v1');
    await handicap.selectOption('group-low-v1');
    await expect(editor.getByText(/Specials still use gross scores/)).toBeVisible();
    await narrowControls(page, editor);
    await editor.getByRole('button', { name: 'Save game', exact: true }).click();
    await expect(page.getByText('Game settings saved.', { exact: true })).toBeVisible();
    expect(fixture.counters().configurations[0]?.find((game) => game.kind === 'dots')).toMatchObject({
      version: 2, mode: 'rotating', rotationHoles: 3, highLow: { version: 1, handicapRule: 'group-low-v1' },
    });
    await page.getByRole('button', { name: 'Enter scores', exact: true }).click();
    await expect(page.getByRole('combobox', { name: 'Dots P1', exact: true })).toBeVisible();
    expect(fixture.counters().writes).toBe(0);
    expect(fixture.counters().pageErrors).toEqual([]);
  } finally { await fixture.close(); }
});

test('Modified Sixes saves first-tee order and net High/Low once with acknowledged combined standings', async ({ page }, testInfo) => {
  const fixture = await openDotsFixture(page, testInfo, 'rotating-high-low');
  try {
    await page.setViewportSize({ width: 390, height: 900 });
    const form = page.getByRole('form', { name: 'Group 1 hole 1 entry', exact: true });
    for (const [index, id] of dotsPlayers.entries()) {
      await form.getByRole('combobox', { name: `Dots P${String(index + 1)}`, exact: true }).selectOption(id);
      await form.getByLabel(`Fictional golfer ${String(index + 1)} score`, { exact: true }).fill(index < 2 ? '3' : '5');
    }
    await form.getByRole('button', { name: 'Save & Next Hole', exact: true }).click();
    await expect(page.getByRole('form', { name: 'Group 1 hole 2 entry', exact: true })).toBeVisible();
    const result = fixture.read().games?.results.find((game) => game.kind === 'dots');
    expect(result?.dotsHighLow?.players.map((player) => player.totalPoints)).toEqual([2, 2, 0, 0]);
    expect(result?.dots?.players.map((player) => player.totalPoints)).toEqual([0, 0, 0, 0]);
    expect(result?.players.map((player) => player.totalPoints)).toEqual([2, 2, 0, 0]);
    expect(fixture.counters().writes).toBe(4);
    const reads = fixture.counters().roundReads;
    await page.getByRole('button', { name: 'Games', exact: true }).click();
    await openGameStandings(page, 'Fictional rotating Dots');
    await expect(page.getByRole('table', { name: 'Saved High/Low and special dots', exact: true })).toBeVisible();
    expect(fixture.counters().roundReads).toBe(reads);
    expect(fixture.counters().pageErrors).toEqual([]);
  } finally { await fixture.close(); }
});

test('Wolf chooses named rotation on the first played tee before declaring, then keeps the saved order', async ({ page }, testInfo) => {
  const fixture = await openDotsFixture(page, testInfo, 'wolf-first-tee');
  try {
    await page.setViewportSize({ width: 320, height: 900 });
    const form = page.getByRole('form', { name: 'Group 1 hole 5 entry', exact: true });
    const first = form.getByRole('combobox', { name: 'First Wolf', exact: true });
    await expect(first).toBeVisible();
    await expect(form.getByRole('combobox', { name: 'Wolf declaration', exact: true })).toBeDisabled();
    const order = [...dotsPlayers].reverse();
    for (const [index, label] of ['First Wolf', 'Second Wolf', 'Third Wolf', 'Fourth Wolf'].entries()) {
      await form.getByRole('combobox', { name: label, exact: true }).selectOption(order[index] ?? '');
    }
    await expect(form.getByText('Wolf: Fictional golfer 4 · Tees last', { exact: true })).toBeVisible();
    await form.getByRole('combobox', { name: 'Wolf declaration', exact: true }).selectOption(`partner:${dotsPlayers[0] ?? ''}`);
    await form.getByRole('button', { name: 'Par for blanks', exact: true }).click();
    await narrowControls(page, form);
    await form.getByRole('button', { name: 'Save & Next Hole', exact: true }).click();
    const next = page.getByRole('form', { name: 'Group 1 hole 6 entry', exact: true });
    await expect(next).toBeVisible();
    await expect(next.getByRole('combobox', { name: 'First Wolf', exact: true })).toHaveCount(0);
    await expect(next.getByText(/Saved Wolf rotation: Fictional golfer 4 → Fictional golfer 3 → Fictional golfer 2 → Fictional golfer 1/)).toBeVisible();
    await expect(next.getByText('Wolf: Fictional golfer 3 · Tees last', { exact: true })).toBeVisible();
    expect(fixture.counters().requests[0]?.score.wolf?.[0]).toMatchObject({
      number: 5, order: { playerIds: order }, choice: { mode: 'partner', partnerId: dotsPlayers[0] },
    });
    expect(fixture.counters().writes).toBe(4);
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
      const initialOrder = await form.getByRole('region', { name: 'Fictional rotating Dots partner rotation', exact: true }).boundingBox();
      const scoreFields = await form.getByLabel('Fictional golfer 1 score', { exact: true }).boundingBox();
      if (!initialOrder || !scoreFields) throw new Error('Missing fictional initial team controls');
      expect(initialOrder.y + initialOrder.height).toBeLessThanOrEqual(scoreFields.y);
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
      await expect(form.getByText('Saved teams · Fictional golfer 1 + Fictional golfer 2 vs Fictional golfer 3 + Fictional golfer 4', { exact: true })).toBeVisible();
      await expect(form.getByText('Preview partner cycle', { exact: true })).toHaveCount(0);
      await expect(form.getByText(/Cycle starts on hole/)).toHaveCount(0);
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
        await expect(editor.getByRole('combobox', { name: 'Team 1 golfer 1', exact: true })).toHaveValue(dotsPlayers[0] ?? '');
        await expect(editor.getByRole('combobox', { name: 'Team 2 golfer 1', exact: true })).toHaveValue(dotsPlayers[2] ?? '');
      }
      await narrowControls(page, editor);
      await editor.getByRole('button', { name: 'Save game', exact: true }).click();
      await expect(page.getByText('Game settings saved.', { exact: true })).toBeVisible();
      expect(fixture.counters().configWrites).toBe(1);
      const configured = fixture.counters().configurations[0]?.find((game) => game.kind === 'dots');
      expect(configured).toMatchObject({ kind: 'dots', mode, stakeMinor: 50 });
      const results = page.getByRole('region', { name: 'Dots results', exact: true });
      await openGameStandings(page, 'Dots');
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
      await openGameStandings(page, 'Dots');
      await expect(results.getByRole('row', { name: /Fictional golfer 1/ }).getByRole('cell').first()).toHaveText(mode === 'individual' ? '5' : '4');
      const settlement = page.getByRole('region', { name: 'Group 1 Dots internal settlement', exact: true });
      await expect(settlement).toContainText('Provisional settlement · Not paid');
      await expect(settlement.locator('.internal-settlement-list > li').filter({ has: page.getByText('Fictional golfer 1', { exact: true }) }).locator('summary'))
        .toContainText(mode === 'individual' ? 'Due USD 6.50' : 'Due USD 3.00');
      await expect(settlement.getByText('Rate and settlement method').locator('..')).not.toHaveAttribute('open', '');
      await settlement.getByText('Rate and settlement method').click();
      await expect(settlement).toContainText(mode === 'individual' ? 'Total to settle: USD 6.50' : 'Total to settle: USD 6.00');
      await expect(results.getByText('Saved award explanations and score evidence', { exact: true })).toHaveCount(0);
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
    expect(fixture.counters().roundReads).toBe(1);
    expect(fixture.counters().roundReadFormats).toEqual(['lean']);
    const form = page.getByRole('form', { name: 'Group 1 hole 1 entry', exact: true });
    const declaration = form.getByRole('combobox', { name: 'Wolf declaration', exact: true });
    const declarationBox = await declaration.boundingBox(), scoreBox = await form.locator('.entry-value input').first().boundingBox();
    expect(declarationBox && scoreBox && declarationBox.y < scoreBox.y).toBe(true);
    await expect(declaration.getByRole('option', { name: 'Fictional golfer 2', exact: true })).toHaveCount(1);
    await expect(declaration.getByRole('option', { name: /Partner:|immediately after/ })).toHaveCount(0);
    await expect(form.getByLabel('Saved solo Wolf turns')).toContainText('Fictional golfer 1');
    await declaration.selectOption('pig');
    await expect(form.getByLabel('Saved solo Wolf turns')).toContainText('Fictional golfer 1');
    await expect(form.getByRole('combobox', { name: 'Wolf match outcome', exact: true })).toHaveCount(0);
    await stageSpecials(form, 'Fictional linked specials');
    for (const input of await form.locator('.group-entry-rows input[inputmode="numeric"]').all()) await input.fill('4');
    await form.getByRole('button', { name: 'Save & Next Hole', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Hole 2', exact: true })).toBeVisible();
    await expect(page.getByRole('form', { name: 'Group 1 hole 2 entry', exact: true })
      .getByLabel('Saved solo Wolf turns')).not.toContainText('Fictional golfer 1');
    expect(fixture.counters().requests[0]?.score).toMatchObject({ dots: [{ players: [{ counts: { sandy: 3 } }, {}] }], wolf: [{ choice: { mode: 'pig' } }] });
    await page.getByRole('button', { name: 'Games', exact: true }).click();
    await openGameStandings(page, 'Fictional earned Wolf');
    await openGameStandings(page, 'Fictional linked specials');
    await expect(page.getByRole('region', { name: 'Fictional earned Wolf results', exact: true }).getByRole('columnheader', { name: 'Earned dots', exact: true })).toBeVisible();
    const results = page.getByRole('region', { name: 'Fictional linked specials results', exact: true });
    await expect(results.getByRole('row', { name: /Fictional golfer 1/ }).getByRole('cell').first()).toHaveText('15');
    const settlement = page.getByRole('region', { name: 'Group 1 Fictional earned Wolf + Fictional linked specials internal settlement', exact: true });
    await expect(settlement).toHaveCount(1);
    await expect(settlement.locator('.internal-settlement-list > li').filter({ has: page.getByText('Fictional golfer 1', { exact: true }) }).locator('summary'))
      .toContainText('Due USD 22.50');
    expect(fixture.read().internalSettlements).toHaveLength(1);
    expect(fixture.read().internalSettlements?.[0]?.gameIds).toHaveLength(2);
    await page.getByRole('button', { name: 'Leaderboard', exact: true }).click();
    const leaderboard = page.getByRole('region', { name: 'Round leaderboard', exact: true });
    const leaderboardGame = leaderboard.getByRole('combobox', { name: 'Leaderboard game' });
    await leaderboardGame.selectOption({ label: 'Fictional earned Wolf + Fictional linked specials · Group 1 · Combined' });
    await expect(leaderboardGame).toHaveValue(/^combined:/);
    const combined = leaderboard.getByRole('list', { name: 'Combined standings', exact: true });
    await expect(combined.locator(':scope > li')).toHaveCount(4);
    await expect(combined.locator(':scope > li').first()).toContainText('Due USD 22.50');
    await narrowControls(page, leaderboard);
    if (testInfo.project.name === 'iphone-16-pro-webkit') await leaderboard.screenshot({ path: 'coverage/mobile-combined-leaderboard.png' });
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
    await expect(page.getByText('Editing this game is temporarily unavailable in this app version.', { exact: true })).toHaveCount(2);
    expect(fixture.counters().writes).toBe(0);
    expect(fixture.counters().configWrites).toBe(0);
    expect(fixture.counters().pageErrors).toEqual([]);
  } finally { await fixture.close(); }
});
