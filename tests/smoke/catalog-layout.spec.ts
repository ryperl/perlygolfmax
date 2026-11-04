import { createServer as createHttpServer } from 'node:http';
import { isValidElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { expect, test } from '@playwright/test';
import { isRecord } from '../../src/contracts/events';
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
  const hmrServer = createHttpServer();
  const renderer = await createServer({
    server: { middlewareMode: true, hmr: { server: hmrServer }, watch: null }, appType: 'custom',
    logLevel: 'error', optimizeDeps: { noDiscovery: true },
  });
  let preview: string;
  try {
    const module: unknown = await renderer.ssrLoadModule('/src/features/catalog/TeeProfilePreview.tsx');
    if (!isRecord(module) || typeof module.TeeProfilePreview !== 'function') throw new Error('Preview component export is missing.');
    const element: unknown = Reflect.apply(module.TeeProfilePreview, undefined, [{ profile }]);
    if (!isValidElement(element)) throw new Error('Preview did not render a React element.');
    preview = renderToStaticMarkup(element);
  } finally { await renderer.close(); }
  expect(hmrServer.listening).toBe(false);
  await page.setContent(`<html><head>${stylesheets.map((href) => `<link rel="stylesheet" href="${href}">`).join('')}</head>
    <body><div class="app"><main><nav class="event-actions" aria-label="Catalog spacing fixture">
    <a href="#events">Events</a><a href="#courses">Course catalog</a><a href="#players">Player catalog</a>
    </nav><section class="catalog-view">${preview}</section></main></div></body></html>`);
  await page.evaluate(() => { document.documentElement.style.fontSize = '125%'; });
  const links = await page.getByRole('navigation', { name: 'Catalog spacing fixture' }).getByRole('link').all();
  for (let index = 1; index < links.length; index++) {
    const previous = await links[index - 1]?.boundingBox();
    const next = await links[index]?.boundingBox();
    if (!previous || !next) throw new Error('Navigation fixture has no rendered link box.');
    if (next.y >= previous.y + previous.height) expect(next.y - previous.y - previous.height).toBeGreaterThanOrEqual(11.5);
    else expect(next.x - previous.x - previous.width).toBeGreaterThanOrEqual(19.5);
  }
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
