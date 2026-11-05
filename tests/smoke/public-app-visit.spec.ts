import { expect, test } from './test';
import { createServer } from 'vite';
import { isHoleScore } from '../../src/contracts/scoring';
import { isRecord } from '../../src/contracts/events';
import type { ScoreWriteResult } from '../../src/domain/scoring';
import type { EventWorkspace } from '../../src/domain/setup';
import { fictionalResumeRound } from './score-resume-fixture-data';
import { fictionalCapturedRound } from './games-fixture-data';

test('the full public app resumes the next hole across eighteen home-screen-style cold visits', async ({ page }, testInfo) => {
  test.setTimeout(90000);
  const server = await createServer({
    configFile: false, cacheDir: testInfo.outputPath('vite-cache'),
    server: { host: '127.0.0.1', port: 0, hmr: false }, esbuild: { jsx: 'automatic' },
    optimizeDeps: { noDiscovery: true, include: ['react', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime'] },
    logLevel: 'error',
  });
  let stored = structuredClone(fictionalResumeRound);
  let writes = 0;
  let reads = 0;
  const errors: string[] = [];
  page.on('pageerror', (error) => { errors.push(error.message); });
  try {
    await server.listen();
    const address = server.httpServer?.address();
    if (!address || typeof address === 'string') throw new Error('Public app fixture server did not start.');
    const origin = `http://127.0.0.1:${String(address.port)}`;
    await page.route(`${origin}/`, (route) => route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="manifest" href="/manifest.webmanifest"></head><body><div id="public-app-fixture"></div><script type="module" src="/tests/smoke/public-app-fixture.tsx"></script></body></html>',
    }));
    await page.route(`${origin}/__public-api/**`, async (route) => {
      const request = route.request();
      expect(request.headers().authorization).toBeUndefined();
      const path = new URL(request.url()).pathname.replace('/__public-api/public/', '');
      if (request.method() === 'GET' && path === 'events') {
        await route.fulfill({ json: { events: [{ id: stored.eventId, name: stored.eventName,
          role: 'viewer', status: 'active', etag: 'public-event', createdAt: '2026-01-01T00:00:00Z' }] } }); return;
      }
      if (request.method() === 'GET' && path.endsWith('/workspace')) {
        const workspace: EventWorkspace = {
          event: { id: stored.eventId, name: stored.eventName, role: 'viewer', status: 'active',
            etag: 'public-event', createdAt: '2026-01-01T00:00:00Z' },
          etag: 'public-event', location: 'Fictional location', publicAccess: true, canViewScores: true,
          roster: stored.cards.map(({ playerId, displayName }) => ({ playerId, displayName })),
          rounds: [{ ...fictionalCapturedRound, id: stored.roundId, name: stored.roundName,
            groups: stored.groups, scoringStarted: stored.setupLocked,
            players: stored.cards.map(({ playerId, displayName }) => ({ playerId, displayName })),
          }],
        };
        await route.fulfill({ json: workspace }); return;
      }
      if (request.method() === 'GET' && path.endsWith('/scores')) {
        reads++;
        await route.fulfill({ json: stored }); return;
      }
      if (request.method() !== 'PUT' || !path.includes('/holes/')) throw new Error(`Unexpected public fixture request: ${path}`);
      const parts = path.split('/');
      const playerId = parts[5];
      const holeNumber = Number(parts[7]);
      const payload: unknown = request.postDataJSON();
      if (!isRecord(payload) || !isHoleScore(payload.score)) throw new Error('Invalid fictional hole input.');
      const card = stored.cards.find((item) => item.playerId === playerId);
      const hole = card?.holes.find((item) => item.number === holeNumber);
      if (!card || !hole) throw new Error('Unknown fictional score target.');
      const headers = request.headers();
      const etag = headers['if-match'] ?? null;
      const requestId = headers['idempotency-key'];
      if (!requestId || card.etag !== etag || etag === null && headers['if-none-match'] !== '*') {
        await route.fulfill({ status: 409, json: { code: 'SCORE_CHANGED' } }); return;
      }
      const score = payload.score;
      const recordedAt = '2026-01-01T00:00:00Z';
      stored = { ...stored, setupLocked: true, lastUpdatedAt: recordedAt,
        cards: stored.cards.map((item) => item.playerId === playerId ? {
          ...item, etag: `fictional-card-${String(++writes)}`, updatedAt: recordedAt,
          holes: item.holes.map((entry) => entry.number === holeNumber ? { ...entry, score } : entry),
        } : item),
      };
      const result: ScoreWriteResult = { round: stored, change: { id: requestId,
        eventId: stored.eventId, roundId: stored.roundId, playerId: card.playerId, holeNumber,
        before: hole.score, after: score, expectedEtag: etag, recordedAt,
        recordedBy: { kind: 'public-score', eventId: stored.eventId },
      } };
      await route.fulfill({ json: result });
    });
    await page.setViewportSize({ width: 402, height: 874 });
    for (let hole = 1; hole <= 18; hole++) {
      await page.goto(hole === 1 ? `${origin}/#events?event=${stored.eventId}&round=${stored.roundId}` : `${origin}/`);
      const form = page.getByRole('form', { name: `Group ${String(hole === 1 ? 1 : 2)} hole ${String(hole)} entry`, exact: true });
      await expect(form).toBeVisible();
      if (hole === 1) await page.getByLabel('View group').selectOption('2');
      expect(await page.evaluate(() => window.innerWidth)).toBe(402);
      await expect(page.getByRole('button', { name: /^Sign (in|out)$/ })).toHaveCount(0);
      await expect(page.getByRole('combobox', { name: /Saved round/ })).toHaveValue(stored.roundId);
      await page.getByLabel('Fictional golfer 3 score', { exact: true }).fill('4');
      await page.getByRole('button', { name: hole === 18 ? 'Save Hole' : 'Save & Next Hole', exact: true }).click();
      await expect(page.getByText(/^Saved —/)).toBeVisible();
      expect(stored.cards[2]?.holes[hole - 1]?.score).toEqual({ kind: 'strokes', strokes: 4 });
      if (hole < 18) {
        const heading = page.getByRole('heading', { name: `Hole ${String(hole + 1)}`, exact: true });
        await expect(heading).toBeFocused();
        await expect(heading).toBeInViewport();
        await expect(page.getByRole('heading', { name: 'Round scorecard', exact: true })).toHaveCount(0);
      } else {
        await expect(page.getByRole('heading', { name: 'Round scorecard', exact: true })).toBeVisible();
      }
      const location = await page.evaluate(() => JSON.parse(localStorage.getItem('perly-golf-max:last-score-location:v1') ?? 'null') as unknown);
      expect(location).toEqual({ version: 1, eventId: stored.eventId, roundId: stored.roundId,
        groupNumber: 2, holeNumber: hole === 18 ? 18 : hole + 1, view: hole === 18 ? 'cards' : 'entry' });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }
    expect(writes).toBe(18);
    expect(reads).toBeGreaterThanOrEqual(18);
    expect(errors).toEqual([]);
  } finally { await server.close(); }
});
