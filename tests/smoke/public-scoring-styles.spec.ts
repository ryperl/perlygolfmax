import { expect, test } from './test';

test('the production public shell loads scoring styles without visiting organizer tools', async ({ page }) => {
  await page.goto('/#events?choose=1');
  await expect(page.getByRole('heading', { name: 'Events', exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => {
    const rules = Array.from(document.styleSheets).flatMap((sheet) => Array.from(sheet.cssRules));
    const picker = rules.find((rule) => rule instanceof CSSStyleRule && rule.selectorText.includes('.score-round-picker select'));
    return picker instanceof CSSStyleRule ? picker.style.minHeight : null;
  })).toBe('44px');
  await page.evaluate(() => {
    const controls = document.createElement('section');
    controls.className = 'owner-scores';
    controls.innerHTML = '<div class="score-round-picker"><label>Round<select aria-label="Round"><option>Fictional round</option></select></label></div><span class="score-save-indicator" data-state="working"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /></svg><span class="score-indicator-label">Updating scores</span></span>';
    const main = document.querySelector('main');
    if (!main) throw new Error('Missing public app main region.');
    main.append(controls);
  });
  const picker = page.getByRole('combobox', { name: 'Round', exact: true });
  await expect(picker).toBeVisible();
  expect(await picker.evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
  await picker.focus();
  await expect(picker).toBeFocused();
  const indicator = page.locator('.score-save-indicator');
  expect(await indicator.locator('.score-indicator-label').evaluate((element) => getComputedStyle(element).clipPath)).toBe('inset(50%)');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await indicator.locator('svg').evaluate((element) => getComputedStyle(element).animationName)).toBe('none');
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toHaveCount(0);
});
