import { createServer } from 'vite';
import type { Page, TestInfo } from '@playwright/test';
import { expect } from './test';
import { isHoleScore, isRoundScores, isScoreWriteResult } from '../../src/contracts/scoring';
import { isEventWorkspace } from '../../src/contracts/setup';
import { isRecord } from '../../src/contracts/events';
import { isRoundGameDefinitions } from '../../src/contracts/games';
import { defaultChurchySpecials } from '../../src/domain/churchy';
import type { ChurchyGameDefinition } from '../../src/domain/churchy';
import { preserveScoreExtras } from '../../src/domain/scoring';
import type { GameWriteResult, HoleScore, RoundScores, ScoreWriteResult } from '../../src/domain/scoring';
import type { EventWorkspace } from '../../src/domain/setup';
import { calculateGameResults } from '../../src/domain/stableford';
import { strokeGameFixture, strokeGameId, strokeGamesRound } from '../../src/domain/stroke-games.test-support';

const fixture = strokeGameFixture(9, 8);
export const churchyPlayers = fixture.cards.map((card) => card.playerId);
export const churchyGames: readonly ChurchyGameDefinition[] = fixture.snapshot.groups.map((group) => ({
  id: strokeGameId(970 + group.number), name: 'Churchy Game', kind: 'churchy', version: 2,
  groupNumber: group.number, playerIds: group.playerIds, basis: 'net', currency: 'USD',
  amountPerDotMinor: group.number === 1 ? 50 : 100,
  enabledSpecials: group.number === 1 ? defaultChurchySpecials : ['sandy'],
}));

function project(round: RoundScores, games = round.games?.configuration.games ?? []): RoundScores {
  return { ...round, games: {
    configuration: { eventId: round.eventId, roundId: round.roundId,
      etag: round.games?.configuration.etag ?? 'fictional-churchy-games-v1', games },
    results: calculateGameResults(games, fixture.snapshot, round.cards),
  } };
}

function workspace(round: RoundScores): EventWorkspace {
  return { event: { id: round.eventId, name: round.eventName, role: 'viewer', status: 'active',
    etag: 'fictional-churchy-event-v1', createdAt: '2026-01-01T00:00:00Z' },
  etag: 'fictional-churchy-event-v1', location: 'Fictional location', publicAccess: true, canViewScores: true,
  roster: round.cards.map(({ playerId, displayName }) => ({ playerId, displayName, handicapIndexValue: '0' })),
  rounds: [{ ...fixture.snapshot, scoringStarted: round.setupLocked,
    players: round.cards.map(({ playerId, displayName }) => ({ playerId, displayName, handicapIndexValue: '0' })) }] };
}

export async function openChurchyV2Fixture(page: Page, testInfo: TestInfo, scenario: 'setup' | 'configured' = 'configured') {
  const server = await createServer({ configFile: false, cacheDir: testInfo.outputPath('vite-cache'),
    server: { host: '127.0.0.1', port: 0, hmr: false }, esbuild: { jsx: 'automatic' },
    optimizeDeps: { noDiscovery: true, include: ['react', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime'] },
    logLevel: 'error' });
  const base = strokeGamesRound(fixture);
  let stored = project({ ...base, setupLocked: false, lastUpdatedAt: null, teeStrokeAllocation: true,
    cards: base.cards.map((card) => ({ ...card, etag: null, updatedAt: null,
      holes: card.holes.map((hole) => ({ ...hole, score: { kind: 'unplayed' } })) })),
    supportedGameKinds: ['churchy', 'dots', 'wolf', 'ball-drop'],
    churchyEnabled: true, churchyRulesVersions: scenario === 'setup' ? [1, 2, 3] : [1, 2], internalGamesSupported: true, wolfRulesVersions: [1, 2],
    permissions: { role: 'public', writePlayerIds: churchyPlayers, canManageGames: false, canManageInternalGames: true },
    gameInputContext: { courseVersionId: fixture.snapshot.courseVersionId, teeProfileId: fixture.snapshot.teeProfile.id },
  }, [fixture.ballDrop, ...(scenario === 'configured' ? churchyGames : [])]);
  let writes = 0, configWrites = 0, pauseFailure = false;
  let releaseFailure: (() => void) | null = null;
  const receipts = new Map<string, ScoreWriteResult>();
  const requests: { readonly id: string; readonly playerId: string; readonly score: HoleScore }[] = [];
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => { pageErrors.push(error.message); });
  expect(isRoundScores(stored)).toBe(true);
  expect(isEventWorkspace(workspace(stored))).toBe(true);
  try {
    await server.listen();
    const address = server.httpServer?.address();
    if (!address || typeof address === 'string') throw new Error('Fictional Churchy server unavailable.');
    const origin = `http://127.0.0.1:${String(address.port)}`;
    await page.route(`${origin}/`, (route) => route.fulfill({ contentType: 'text/html',
      body: '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="public-app-fixture"></div><script type="module" src="/tests/smoke/public-app-fixture.tsx"></script></body></html>' }));
    await page.route(`${origin}/__public-api/**`, async (route) => {
      const request = route.request(), headers = request.headers();
      expect(headers.authorization).toBeUndefined();
      const path = new URL(request.url()).pathname.replace('/__public-api/public/', '');
      if (request.method() === 'GET') {
        if (path === 'events') return route.fulfill({ json: { events: [workspace(stored).event] } });
        if (path.endsWith('/workspace')) return route.fulfill({ json: workspace(stored) });
        if (path.endsWith('/scores')) return route.fulfill({ json: stored });
        throw new Error(`Unexpected fictional Churchy read: ${path}`);
      }
      const payload: unknown = request.postDataJSON();
      const id = headers['idempotency-key'], expectedEtag = headers['if-match'] ?? null;
      if (request.method() !== 'PUT' || !isRecord(payload) || !id) throw new Error('Missing conditional fictional Churchy request.');
      if (!path.includes('/holes/') && path.endsWith('/games')) {
        if (!isRoundGameDefinitions(payload.games) || !stored.games) throw new Error('Invalid fictional Churchy configuration.');
        expect(stored.setupLocked).toBe(false);
        expect(stored.permissions?.canManageInternalGames).toBe(true);
        expect(expectedEtag).toBe(stored.games.configuration.etag);
        expect(payload.games.find((game) => game.id === fixture.ballDrop.id)).toEqual(fixture.ballDrop);
        const before = stored.games.configuration.games;
        stored = project({ ...stored, games: { ...stored.games, configuration: { ...stored.games.configuration,
          etag: `fictional-churchy-games-v${String(++configWrites + 1)}` } } }, payload.games);
        const result: GameWriteResult = { round: stored, change: { id, eventId: stored.eventId, roundId: stored.roundId,
          expectedEtag, before, after: payload.games, recordedAt: '2026-01-01T00:00:00Z',
          recordedBy: { kind: 'public-score', eventId: stored.eventId } } };
        expect(isRoundScores(stored)).toBe(true);
        return route.fulfill({ json: result });
      }
      if (!isHoleScore(payload.score)) throw new Error('Invalid fictional Churchy score.');
      const parts = path.split('/'), playerId = parts[5], holeNumber = Number(parts[7]);
      const card = stored.cards.find((entry) => entry.playerId === playerId);
      const before = card?.holes.find((hole) => hole.number === holeNumber)?.score;
      if (!card || !before) throw new Error('Unknown fictional Churchy score target.');
      requests.push({ id, playerId: card.playerId, score: payload.score });
      const replay = receipts.get(id);
      if (replay) return route.fulfill({ json: { ...replay, round: stored } });
      expect(expectedEtag).toBe(card.etag);
      if (pauseFailure) {
        pauseFailure = false;
        await new Promise<void>((resolve) => { releaseFailure = resolve; });
        return route.fulfill({ status: 503, json: { message: 'Fictional interrupted Churchy acknowledgement.' } });
      }
      const after = preserveScoreExtras(payload.score, before), recordedAt = '2026-01-01T00:00:00Z';
      stored = project({ ...stored, setupLocked: true, lastUpdatedAt: recordedAt,
        permissions: { role: 'public', writePlayerIds: churchyPlayers, canManageGames: false, canManageInternalGames: false },
        cards: stored.cards.map((entry) => entry.playerId === card.playerId ? { ...entry,
          etag: `fictional-churchy-card-v${String(++writes)}`, updatedAt: recordedAt,
          holes: entry.holes.map((hole) => hole.number === holeNumber ? { ...hole, score: after } : hole),
        } : entry) });
      const result: ScoreWriteResult = { round: stored, change: { id, eventId: stored.eventId, roundId: stored.roundId,
        playerId: card.playerId, holeNumber, before, after, expectedEtag, recordedAt,
        recordedBy: { kind: 'public-score', eventId: stored.eventId } } };
      expect(isScoreWriteResult(result)).toBe(true);
      receipts.set(id, result);
      return route.fulfill({ json: result });
    });
    await page.goto(`${origin}/#events?event=${stored.eventId}&round=${stored.roundId}`);
    await expect(page.getByRole('form', { name: 'Group 1 hole 1 entry', exact: true })).toBeVisible();
    return { close: () => server.close(), read: () => stored,
      counters: () => ({ writes, configWrites, requests, pageErrors }),
      pauseNextFailure() { pauseFailure = true; },
      releaseFailure() {
        if (!releaseFailure) throw new Error('No fictional Churchy acknowledgement is paused.');
        releaseFailure(); releaseFailure = null;
      } };
  } catch (error) { await server.close(); throw error; }
}
