import { expect, test } from '@playwright/test';
import { renderComponentFixture } from './render-fixture';
import type { TeeProfile } from '../../src/domain/catalog';

const profile: TeeProfile = {
  id: 901, name: 'Fictional Teal', category: 'Fictional rating', holeCount: 18,
  totalYardage: 6300, totalMeters: 5760, totalPar: 72, strokeAllocation: true, shorter: false, eligibleSides: 'All',
  holes: Array.from({ length: 18 }, (_, i) => ({ number: i + 1, sourceId: i + 1, length: 350, par: 4, allocation: i + 1 })),
  ratings: [
    { type: 'Total', course: 72, slope: 120, bogey: 90 },
    { type: 'Front', course: 36, slope: 120, bogey: 45 },
    { type: 'Back', course: 36, slope: 120, bogey: 45 },
  ],
};

test('catalog navigation gaps and actual hole preview fit narrow and enlarged layouts', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto('/#events');
  await expect(page.getByRole('heading', { level: 1, name: 'Events', exact: true })).toBeVisible();
  const stylesheets = await page.locator('link[rel="stylesheet"]').evaluateAll((links) =>
    links.map((link) => link.getAttribute('href')).filter((href): href is string => href !== null));
  const preview = await renderComponentFixture('/src/features/catalog/TeeProfilePreview.tsx', 'TeeProfilePreview', { profile });
  const selector = await renderComponentFixture('/src/features/catalog/TeeProfilePreview.tsx', 'TeeProfileSelector', {
    profiles: [profile, { ...profile, id: 902, category: 'Fictional alternate' }],
  });
  await page.setContent(`<html><head>${stylesheets.map((href) => `<link rel="stylesheet" href="${href}">`).join('')}</head>
    <body><div class="app"><main><nav class="event-actions" aria-label="Catalog spacing fixture">
    <a href="#events">Events</a><a href="#courses">Course catalog</a><a href="#players">Player catalog</a>
    </nav><div class="event-card-actions" role="group" aria-label="Event card spacing fixture">
    <a href="#workspace">Open fictional ${'Event'.repeat(20)} workspace</a><button type="button">Archive event</button>
    </div><section class="catalog-view">${selector}${preview}</section></main></div></body></html>`);
  await page.evaluate(() => { document.documentElement.style.fontSize = '125%'; });
  const tee = page.getByRole('combobox', { name: 'Preview tee' });
  await expect(tee).toHaveValue('');
  await tee.focus();
  await expect(tee).toBeFocused();
  await expect(page.getByRole('region', { name: 'Tee preview' }).locator('.tee-preview')).toHaveCount(0);
  const links = await page.getByRole('navigation', { name: 'Catalog spacing fixture' }).getByRole('link').all();
  for (let index = 1; index < links.length; index++) {
    const previous = await links[index - 1]?.boundingBox();
    const next = await links[index]?.boundingBox();
    if (!previous || !next) throw new Error('Navigation fixture has no rendered link box.');
    if (next.y >= previous.y + previous.height) expect(next.y - previous.y - previous.height).toBeGreaterThanOrEqual(11.5);
    else expect(next.x - previous.x - previous.width).toBeGreaterThanOrEqual(19.5);
  }
  const card = page.getByRole('group', { name: 'Event card spacing fixture' });
  const workspace = await card.getByRole('link').boundingBox();
  const archive = await card.getByRole('button').boundingBox();
  if (!workspace || !archive) throw new Error('Event card fixture has no rendered action boxes.');
  if (archive.y >= workspace.y + workspace.height) expect(archive.y - workspace.y - workspace.height).toBeGreaterThanOrEqual(11.5);
  else expect(archive.x - workspace.x - workspace.width).toBeGreaterThanOrEqual(19.5);
  const summary = page.locator('summary');
  await summary.focus();
  await expect(summary).toBeFocused();
  await summary.press('Enter');
  const holes = page.getByRole('table', { name: 'Hole yardage, par and stroke index' });
  await expect(holes).toBeVisible();
  await expect(holes.getByRole('row')).toHaveCount(20);
  await expect(page.getByRole('table', { name: 'Course and slope ratings' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
