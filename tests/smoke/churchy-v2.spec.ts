import type { Locator, Page } from '@playwright/test';
import { expect, test } from './test';
import { contrastRatio } from './contrast';
import { openChurchyV2Fixture } from './churchy-v2-fixture';

async function fits(page: Page, scope: Locator) {
  for (const select of await scope.getByRole('combobox').all()) {
    const style = await select.evaluate((element) => {
      const computed = getComputedStyle(element), label = element.closest('label');
      return { height: element.getBoundingClientRect().height, color: computed.color, background: computed.backgroundColor,
        fits: label !== null && label.scrollWidth <= label.clientWidth };
    });
    expect(style.height).toBeGreaterThanOrEqual(44);
    expect(style.fits).toBe(true);
    expect(contrastRatio(style.color, style.background)).toBeGreaterThanOrEqual(4.5);
  }
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

for (const theme of ['light', 'dark'] as const) {
  test(`Churchy v2 shared counts, saved gross progress and independent groups at narrow ${theme}`, async ({ page }, testInfo) => {
    test.setTimeout(30000);
    const fixture = await openChurchyV2Fixture(page, testInfo);
    try {
      await page.setViewportSize({ width: 320, height: 900 });
      await page.evaluate((value) => {
        document.documentElement.dataset.theme = value;
        document.documentElement.style.fontSize = '125%';
      }, theme);
      let form = page.getByRole('form', { name: 'Group 1 hole 1 entry', exact: true });
      const first = page.getByRole('article', { name: 'Fictional golfer 1 scorecard', exact: true });
      await expect(first.locator('.entry-heading')).toContainText('Thru 0');
      await first.getByRole('button', { name: 'Dots for Fictional golfer 1', exact: true }).click();
      let dialog = page.getByRole('dialog', { name: 'Fictional golfer 1 · Hole 1 dots', exact: true });
      await dialog.getByLabel(/Sticky/).check();
      await dialog.getByLabel(/Sandy count/).fill('2');
      await dialog.getByLabel(/Other dots/).fill('3');
      for (const input of await dialog.locator('input:not([type="checkbox"])').all()) {
        const bounds = await input.boundingBox();
        expect(bounds?.width).toBeGreaterThanOrEqual(44);
        expect(bounds?.height).toBeGreaterThanOrEqual(44);
      }
      expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
      await dialog.getByRole('button', { name: 'Return to score entry', exact: true }).click();
      for (const input of await form.locator('.entry-value input').all()) await input.fill('4');
      await expect(first.locator('.entry-heading')).toContainText('Thru 0');
      fixture.pauseNextFailure();
      await form.getByRole('button', { name: 'Save & Next Hole', exact: true }).click();
      await expect.poll(() => fixture.counters().requests.length).toBe(1);
      await expect(form.getByRole('button', { name: 'Save & Next Hole', exact: true })).toBeDisabled();
      expect(fixture.counters().writes).toBe(0);
      fixture.releaseFailure();
      await expect(form.getByRole('button', { name: 'Save & Next Hole', exact: true })).toBeEnabled();
      await first.getByRole('button', { name: 'Dots for Fictional golfer 1', exact: true }).click();
      dialog = page.getByRole('dialog', { name: 'Fictional golfer 1 · Hole 1 dots', exact: true });
      await expect(dialog.getByLabel(/Sticky/)).toBeChecked();
      await expect(dialog.getByLabel(/Sandy count/)).toHaveValue('2');
      await expect(dialog.getByLabel(/Other dots/)).toHaveValue('3');
      await dialog.getByRole('button', { name: 'Return to score entry', exact: true }).click();
      const failed = fixture.counters().requests[0];
      await form.getByRole('button', { name: 'Save & Next Hole', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Hole 2', exact: true })).toBeVisible();
      expect(fixture.counters().writes).toBe(4);
      expect(fixture.counters().requests[1]).toEqual(failed);
      expect(fixture.counters().requests[1]?.score.churchy).toMatchObject({
        version: 2, sticky: true, sandyCount: 2, otherDots: 3,
      });
      await expect(first.locator('.entry-heading')).toContainText(/Thru 1\s+E/);
      await page.getByRole('combobox', { name: 'Jump to hole', exact: true }).selectOption('3');
      form = page.getByRole('form', { name: 'Group 1 hole 3 entry', exact: true });
      await form.getByLabel('Fictional golfer 1 score', { exact: true }).fill('5');
      await expect(first.locator('.entry-heading')).toContainText(/Thru 1\s+E/);
      await form.getByRole('button', { name: 'Save & Next Hole', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Hole 4', exact: true })).toBeVisible();
      await expect(first.locator('.entry-heading')).toContainText(/Thru 2\s+\+1/);
      await expect(first.locator('.entry-heading')).not.toContainText('Incomplete');
      const firstGame = fixture.read().games?.results.find((result) => result.kind === 'churchy');
      expect(firstGame?.players.map((player) => player.totalPoints)).toEqual([6, 6, 0, 0]);
      await page.getByRole('combobox', { name: 'View group', exact: true }).selectOption('2');
      const second = page.getByRole('article', { name: 'Fictional golfer 5 scorecard', exact: true });
      await expect(second.locator('.entry-heading')).toContainText('Thru 0');
      await second.getByRole('button', { name: 'Dots for Fictional golfer 5', exact: true }).click();
      dialog = page.getByRole('dialog', { name: /Fictional golfer 5 · Hole \d+ dots/ });
      await expect(dialog.getByLabel(/Sticky/)).toHaveCount(0);
      await dialog.getByLabel(/Other dots/).fill('2');
      await dialog.getByRole('button', { name: 'Return to score entry', exact: true }).click();
      form = page.getByRole('form', { name: /Group 2 hole \d+ entry/ });
      for (const input of await form.locator('.entry-value input').all()) await input.fill('4');
      await form.getByRole('button', { name: 'Save & Next Hole', exact: true }).click();
      await expect.poll(() => fixture.counters().writes).toBe(9);
      expect(fixture.read().games?.results.filter((result) => result.kind === 'churchy')
        .map((result) => result.players.map((player) => player.totalPoints))).toEqual([[6, 6, 0, 0], [2, 2, 0, 0]]);
      await page.getByRole('button', { name: 'Games', exact: true }).click();
      await expect(page.getByText(/experimental/i)).toHaveCount(0);
      await expect(page.getByText('Total to settle:', { exact: false }).first()).toBeVisible();
      await fits(page, page.getByRole('region', { name: 'Round games', exact: true }));
      if (testInfo.project.name === 'desktop-chromium') {
        await page.setViewportSize({ width: 1280, height: 900 });
        await fits(page, page.getByRole('region', { name: 'Round games', exact: true }));
      }
      expect(fixture.counters().pageErrors).toEqual([]);
    } finally { await fixture.close(); }
  });
}

test('Churchy setup saves separate fixed-value special choices for both foursomes beside Ball Drop', async ({ page }, testInfo) => {
  test.setTimeout(30000);
  const fixture = await openChurchyV2Fixture(page, testInfo, 'setup');
  try {
    await page.setViewportSize({ width: 320, height: 900 });
    await page.evaluate(() => {
      document.documentElement.dataset.theme = 'dark';
      document.documentElement.style.fontSize = '125%';
    });
    await page.getByRole('button', { name: 'Games', exact: true }).click();
    for (const groupNumber of [1, 2]) {
      await page.getByRole('button', { name: 'Add game', exact: true }).click();
      const editor = page.getByRole('form', { name: 'Game settings', exact: true });
      await editor.getByRole('combobox', { name: 'Game type', exact: true }).selectOption('churchy');
      await editor.getByRole('combobox', { name: 'Churchy playing group', exact: true }).selectOption(String(groupNumber));
      await editor.getByLabel('USD per dot', { exact: true }).fill('.50');
      if (groupNumber === 1) await editor.getByLabel(/Sticky/).uncheck();
      await fits(page, editor);
      await editor.getByRole('button', { name: 'Save game', exact: true }).click();
      await expect(page.getByText('Game settings saved.', { exact: true })).toBeVisible();
    }
    const games = fixture.read().games?.configuration.games.filter((game) => game.kind === 'churchy');
    expect(games?.map((game) => [game.version, game.groupNumber, game.amountPerDotMinor])).toEqual([[2, 1, 50], [2, 2, 50]]);
    expect(games?.[0]?.version === 2 && games[0].enabledSpecials.includes('sticky')).toBe(false);
    expect(games?.[1]?.version === 2 && games[1].enabledSpecials.includes('sticky')).toBe(true);
    expect(fixture.counters().configWrites).toBe(2);
    expect(fixture.counters().writes).toBe(0);
    await expect(page.getByText(/experimental/i)).toHaveCount(0);
    expect(fixture.counters().pageErrors).toEqual([]);
  } finally { await fixture.close(); }
});
