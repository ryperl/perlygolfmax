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

async function stageSpecials(form: Locator) {
  const first = 'Fictional golfer 1', second = 'Fictional golfer 2';
  await form.getByText(`${first} · Specials and calls`, { exact: true }).click();
  await form.getByLabel(`Sandy count · ${first}`, { exact: true }).fill('3');
  await form.getByRole('button', { name: `Call Paree · ${first}`, exact: true }).click();
  await form.getByRole('combobox', { name: `Paree call 1 · ${first}`, exact: true }).selectOption('success');
  await form.getByText(`${second} · Specials and calls`, { exact: true }).click();
  await form.getByRole('button', { name: `Call Paree · ${second}`, exact: true }).click();
  await form.getByRole('combobox', { name: `Paree call 1 · ${second}`, exact: true }).selectOption('failure');
}

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
      const controls = form.locator('.round-game-hole-controls');
      expect(await form.evaluate((element) => element.querySelector('form'))).toBeNull();
      expect(await controls.evaluate((element) => {
        const scores = element.closest('form')?.querySelector('.group-entry-rows');
        return !!scores && (scores.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
      })).toBe(true);
      await expect(form.locator('button[type="submit"], button:not([type])')).toHaveCount(1);
      await stageSpecials(form);
      await narrowControls(page, controls);
      expect(fixture.counters().writes).toBe(0);
      await page.getByRole('button', { name: 'Next hole', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Hole 1', exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Games', exact: true }).click();
      await expect(results.getByRole('row', { name: /Fictional golfer 1/ }).getByRole('cell').first()).toHaveText('—');
      await page.getByRole('button', { name: 'Enter scores', exact: true }).click();
      const rawScores = form.locator('.group-entry-rows input[inputmode="numeric"]');
      await expect(rawScores).toHaveCount(4);
      for (const input of await rawScores.all()) await input.fill('4');
      fixture.pauseNextFailure();
      await form.getByRole('button', { name: 'Save & Next Hole', exact: true }).click();
      await expect.poll(() => fixture.counters().requests.length).toBe(1);
      await expect(form.getByRole('button', { name: 'Save & Next Hole', exact: true })).toBeDisabled();
      await expect(form.getByLabel('Sandy count · Fictional golfer 1', { exact: true })).toBeDisabled();
      expect(fixture.counters().writes).toBe(0);
      await expect(page.getByRole('heading', { name: 'Hole 1', exact: true })).toBeVisible();
      fixture.releaseFailure();
      await expect(form.getByRole('button', { name: 'Save & Next Hole', exact: true })).toBeEnabled();
      await expect(form.getByLabel('Sandy count · Fictional golfer 1', { exact: true })).toHaveValue('3');
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
    await stageSpecials(form);
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
    await expect(form.getByRole('button', { name: 'Clear Fictional linked specials hole specials', exact: true })).toBeDisabled();
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
