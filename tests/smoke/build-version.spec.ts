import { expect, test } from './test';

for (const theme of ['light', 'dark']) {
  test(`footer version identifies the actual build without brackets at narrow ${theme}`, async ({ page }) => {
    await page.goto('/#preview');
    await page.setViewportSize({ width: 320, height: 900 });
    await page.evaluate((value) => {
      document.documentElement.dataset.theme = value;
      document.documentElement.style.fontSize = '125%';
    }, theme);
    const footer = page.getByRole('contentinfo');
    await expect(footer).toContainText('Built for the trip. Still finding its swing.');
    const label = footer.locator('.site-version');
    await expect(label).toHaveText(/^v0\.1\.0 · [a-f0-9]{8}(?:-local)?$/);
    await expect(label).not.toContainText(/[[\]]/);
    await expect(label).toHaveAttribute('title', /^Build [a-f0-9]{40} · Built \d{4}-/);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
