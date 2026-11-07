import { expect, test } from './test';
import { createServer } from 'vite';
import { isHoleScore } from '../../src/contracts/scoring';
import type { ScoreWriteResult } from '../../src/domain/scoring';
import { fictionalResumeRound } from './score-resume-fixture-data';

test('public group entry survives repeated cold visits with navigation-only storage', async ({ page }, testInfo) => {
  const server = await createServer({
    configFile: false, cacheDir: testInfo.outputPath('vite-cache'),
    server: { host: '127.0.0.1', port: 0, hmr: false }, esbuild: { jsx: 'automatic' },
    optimizeDeps: { noDiscovery: true, include: ['react', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime'] },
    logLevel: 'error',
  });
  let stored = structuredClone(fictionalResumeRound);
  let saves = 0;
  let reads = 0;
  let failSave = false;
  const errors: string[] = [];
  page.on('pageerror', (error) => { errors.push(error.message); });
  try {
    await server.listen();
    const address = server.httpServer?.address();
    if (!address || typeof address === 'string') throw new Error('Fictional resume server did not start.');
    const origin = `http://127.0.0.1:${String(address.port)}`;
    await page.route(`${origin}/__resume-fixture*`, (route) => route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="score-resume-fixture"></div><script type="module" src="/tests/smoke/score-resume-fixture.tsx"></script></body></html>',
    }));
    await page.route(`${origin}/__resume-round`, (route) => { reads++; return route.fulfill({ json: stored }); });
    await page.route(`${origin}/__resume-save`, async (route) => {
      if (failSave) { await route.fulfill({ status: 503, json: { error: 'Fictional connection failure' } }); return; }
      const value: unknown = route.request().postDataJSON();
      if (typeof value !== 'object' || value === null
        || !('playerId' in value) || typeof value.playerId !== 'string'
        || !('holeNumber' in value) || typeof value.holeNumber !== 'number'
        || !('requestId' in value) || typeof value.requestId !== 'string'
        || !('etag' in value) || value.etag !== null && typeof value.etag !== 'string'
        || !('score' in value) || !isHoleScore(value.score)) throw new Error('Invalid fictional save payload.');
      const card = stored.cards.find((item) => item.playerId === value.playerId);
      const hole = card?.holes.find((item) => item.number === value.holeNumber);
      if (!card || !hole || card.etag !== value.etag) { await route.fulfill({ status: 409, json: {} }); return; }
      const score = value.score;
      saves++;
      const recordedAt = '2026-01-01T00:00:00Z';
      stored = {
        ...stored, setupLocked: true, lastUpdatedAt: recordedAt,
        cards: stored.cards.map((item) => item.playerId !== value.playerId ? item : {
          ...item, etag: `fictional-card-${String(saves)}`, updatedAt: recordedAt,
          holes: item.holes.map((entry) => entry.number === value.holeNumber ? { ...entry, score } : entry),
        }),
      };
      const result: ScoreWriteResult = {
        round: stored, change: {
          id: value.requestId, eventId: stored.eventId, roundId: stored.roundId, playerId: value.playerId,
          holeNumber: value.holeNumber, before: hole.score, after: value.score, expectedEtag: value.etag,
          recordedAt, recordedBy: { kind: 'public-score', eventId: stored.eventId },
        },
      };
      await route.fulfill({ json: result });
    });
    // iPhone 16 Pro's CSS viewport, not Pro Max; the meta viewport must be effective.
    await page.setViewportSize({ width: 402, height: 874 });
    for (const hole of [1, 2, 3]) {
      await page.goto(`${origin}/__resume-fixture`);
      await expect(page.getByRole('heading', { name: `Hole ${String(hole)}`, exact: true })).toBeVisible();
      expect(await page.evaluate(() => window.innerWidth)).toBe(402);
      await expect(page.getByLabel('View group')).toHaveValue('2');
      const field = page.getByRole('textbox', { name: 'Fictional golfer 3 score' });
      await field.fill(String(hole + 3));
      await field.press('Enter');
      await expect(page.getByRole('textbox', { name: 'Fictional golfer 4 score' })).toBeFocused();
      await page.getByRole('button', { name: 'Save & Next Hole', exact: true }).click();
      await expect(page.getByRole('status', { name: 'Scores saved', exact: true })).toBeVisible();
      await expect(page.getByRole('heading', { name: `Hole ${String(hole + 1)}`, exact: true })).toBeFocused();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      const payload = await page.evaluate(() => JSON.parse(localStorage.getItem('perly-golf-max:last-score-location:v1') ?? 'null') as unknown);
      expect(payload).toEqual({ version: 1, eventId: stored.eventId, roundId: stored.roundId, groupNumber: 2, holeNumber: hole + 1, view: 'entry' });
    }
    expect(saves).toBe(3);
    expect(reads).toBe(3);
    failSave = true;
    await page.getByRole('textbox', { name: 'Fictional golfer 3 score' }).fill('7');
    await page.getByRole('button', { name: 'Save & Next Hole', exact: true }).click();
    await expect(page.getByText(/remaining not confirmed/)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Hole 4', exact: true })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Fictional golfer 3 score' })).toHaveValue('7');
    expect(saves).toBe(3);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Hole 4', exact: true })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Fictional golfer 3 score' })).toHaveValue('');
    expect(errors).toEqual([]);
  } finally { await server.close(); }
});
