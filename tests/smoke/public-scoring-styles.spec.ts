import { expect, test } from './test';

test('the production public shell loads scoring styles without visiting organizer tools', async ({ page }) => {
  await page.goto('/#events?choose=1');
  await expect(page.getByRole('heading', { name: 'Events', exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => {
    const rules = Array.from(document.styleSheets).flatMap((sheet) => Array.from(sheet.cssRules));
    const picker = rules.find((rule) => rule instanceof CSSStyleRule && rule.selectorText.includes('.score-round-picker select'));
    return picker instanceof CSSStyleRule ? picker.style.minHeight : null;
  })).toBe('44px');
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toHaveCount(0);
});
