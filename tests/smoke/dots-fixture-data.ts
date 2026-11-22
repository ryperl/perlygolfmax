import { createServer } from 'vite';
import type { Page, TestInfo } from '@playwright/test';
import { expect } from './test';
import { isHoleScore, isRoundScores, isScoreWriteResult } from '../../src/contracts/scoring';
import { isEventWorkspace } from '../../src/contracts/setup';
import { isRecord } from '../../src/contracts/events';
import { isRoundGameDefinitions } from '../../src/contracts/games';
import { preserveScoreExtras } from '../../src/domain/scoring';
import type { GameWriteResult, HoleScore, RoundScores, ScoreWriteResult } from '../../src/domain/scoring';
import type { RoundGameDefinition } from '../../src/domain/games';
import type { DotsGameDefinition } from '../../src/domain/dots';
import { dotsSpecialCatalog } from '../../src/domain/dots';
import type { WolfGameDefinition } from '../../src/domain/wolf';
import type { EventWorkspace } from '../../src/domain/setup';
import { calculateGameResults } from '../../src/domain/stableford';
import { calculateInternalSettlements } from '../../src/domain/internal-games';
import { strokeGameFixture, strokeGameId, strokeGamesRound } from '../../src/domain/stroke-games.test-support';
import { leanRoundScores, leanScoreWriteResult } from '../../src/contracts/lean-round-scores';

export const dotsFixture = strokeGameFixture(9);
export const dotsPlayers = dotsFixture.cards.map((card) => card.playerId);
const wolf: WolfGameDefinition = { id: strokeGameId(960), name: 'Fictional earned Wolf', kind: 'wolf', version: 2,
  groupNumber: 1, playerIds: dotsPlayers, basis: 'gross', allowPig: true, stakeMinor: 50 };
const dots: DotsGameDefinition = { id: strokeGameId(961), name: 'Fictional linked specials', kind: 'dots', version: 1,
  groupNumber: 1, playerIds: dotsPlayers, mode: 'linked', linkedGameId: wolf.id,
  specials: [{ kind: 'sandy', units: 1 }, { kind: 'paree', units: 1 }] };

function project(round: RoundScores, games = round.games?.configuration.games ?? [], snapshot = dotsFixture.snapshot): RoundScores {
  const results = calculateGameResults(games, { ...snapshot, groups: round.groups,
    players: snapshot.players.filter((player) => round.cards.some((card) => card.playerId === player.playerId)) },
  round.cards, round.stringRulesVersion ?? 1, round.dotsCategorySweepsVersion ?? 0);
  return { ...round, games: {
    configuration: { eventId: round.eventId, roundId: round.roundId,
      etag: round.games?.configuration.etag ?? 'fictional-dots-games-v1', games },
    results,
  }, internalSettlements: calculateInternalSettlements(games, results, round) };
}

function workspace(round: RoundScores, snapshot = dotsFixture.snapshot): EventWorkspace {
  return { event: { id: round.eventId, name: round.eventName, role: 'viewer', status: 'active',
    etag: 'fictional-dots-event-v1', createdAt: '2026-01-01T00:00:00Z' },
  etag: 'fictional-dots-event-v1', location: 'Fictional location', publicAccess: true, canViewScores: true,
  roster: round.cards.map(({ playerId, displayName }) => ({ playerId, displayName, handicapIndexValue: '0' })),
  rounds: [{ ...snapshot, groups: round.groups, scoringStarted: round.setupLocked,
    players: round.cards.map(({ playerId, displayName }) => ({ playerId, displayName, handicapIndexValue: '0' })) }] };
}

export async function openDotsFixture(page: Page, testInfo: TestInfo,
  scenario: 'setup' | 'setup-high-low' | 'rotating-high-low' | 'wolf-first-tee' | 'linked' | 'old-api' | 'rotating-3' | 'rotating-6' | 'individual-1' | 'individual-2' | 'individual-3'
    | 'string-rules' | 'called-targets' | 'pully-targets' | 'category-sweeps' | 'manual-sweep' | 'setup-sweep' | 'coexistence' = 'setup') {
  const server = await createServer({ configFile: false, cacheDir: testInfo.outputPath('vite-cache'),
    server: { host: '127.0.0.1', port: 0, hmr: false }, esbuild: { jsx: 'automatic' },
    optimizeDeps: { noDiscovery: true, include: ['react', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime'] },
    logLevel: 'error' });
  const playerCount = scenario.startsWith('individual-') ? Number(scenario.slice(-1)) : 4;
  const categorySweeps = scenario === 'category-sweeps';
  const coexistence = scenario === 'coexistence';
  const pullyTargets = scenario === 'pully-targets';
  const highLow = scenario === 'setup-high-low' || scenario === 'rotating-high-low';
  const firstTee = scenario === 'wolf-first-tee';
  const wolfOrders = firstTee || scenario === 'setup-sweep';
  const sweepRules = scenario === 'manual-sweep' || scenario === 'setup-sweep';
  const modernRules = scenario === 'string-rules' || scenario === 'called-targets' || pullyTargets || categorySweeps || scenario === 'manual-sweep' || coexistence;
  const snapshot = scenario === 'string-rules' ? { ...dotsFixture.snapshot, teeProfile: { ...dotsFixture.snapshot.teeProfile,
    holes: dotsFixture.snapshot.teeProfile.holes.map((hole) => ({ ...hole, par: hole.number === 2 ? 5 : hole.number === 3 ? 3 : hole.par })) } }
    : categorySweeps || coexistence ? { ...dotsFixture.snapshot, teeProfile: { ...dotsFixture.snapshot.teeProfile,
      totalPar: dotsFixture.snapshot.teeProfile.totalPar + (coexistence ? 0 : 1),
      holes: dotsFixture.snapshot.teeProfile.holes.map((hole) => ({ ...hole, par: hole.number === 1 ? 5 : coexistence && hole.number === 2 ? 3 : 4 })) } }
      : dotsFixture.snapshot;
  const base = strokeGamesRound(playerCount === 4 ? { ...dotsFixture, snapshot } : strokeGameFixture(9, playerCount));
  const ids = dotsPlayers.slice(0, playerCount);
  const seeded = scenario === 'string-rules' || categorySweeps;
  const stringScores = [[4, 4, 3], [3, 4, 1]] as const;
  const initial: RoundScores = { ...base, setupLocked: seeded, lastUpdatedAt: seeded ? '2026-01-01T00:00:00Z' : null,
    teeStrokeAllocation: true, ...(modernRules || sweepRules ? { stringRulesVersion: 2 as const } : {}),
    ...(highLow ? { dotsHighLowVersion: 1 as const } : {}),
    ...(wolfOrders ? { wolfOrderVersion: 1 as const } : {}),
    ...(categorySweeps ? { dotsCategorySweepsVersion: 1 as const } : {}),
    ...(coexistence ? { dotsCoexistenceRulesVersion: 2 as const } : {}),
    ...(sweepRules ? { dotsManualSweep: true as const, wolfHighLowSweep: true as const, sweepRulesVersion: 2 as const,
      dotsCategorySweepsVersion: 1 as const,
      dotsSpecialKinds: dotsSpecialCatalog.map((special) => special.kind) } : {}),
    ...(scenario === 'called-targets' || pullyTargets ? { dotsCallTargets: true as const } : {}),
    ...(pullyTargets ? { pullyMurphyTargets: true as const, gameCalculationsVersion: 2 as const } : {}),
    groups: [{ ...base.groups[0], number: 1, playerIds: ids, ...(firstTee ? { startingHole: 5 } : {}) }],
    cards: base.cards.slice(0, playerCount).map((card, index) => ({ ...card,
      etag: seeded ? `fictional-string-card-${String(index)}` : null, updatedAt: seeded ? '2026-01-01T00:00:00Z' : null,
      holes: card.holes.map((hole) => ({ ...hole, score: categorySweeps && hole.number === 1
        ? { kind: 'strokes', strokes: 5, ...(index === 0 ? { dots: [{
          number: 1, gameId: strokeGameId(963), gameEtag: 'fictional-dots-games-v1', players: [],
          contests: [{ kind: 'long-drive', status: 'awarded', winnerId: card.playerId },
            { kind: 'blue-plate', status: 'awarded', winnerId: card.playerId }],
        }] } : {}) }
        : !categorySweeps && seeded && hole.number <= 3
        ? { kind: 'strokes', strokes: stringScores[index]?.[hole.number - 1]
          ?? (snapshot.teeProfile.holes.find((entry) => entry.number === hole.number)?.par ?? 4) + 1 }
        : { kind: 'unplayed' } })) })),
    supportedGameKinds: scenario === 'old-api' ? ['skins'] : ['dots', 'wolf', 'skins'],
    ...(scenario === 'old-api' ? {} : { dotsRulesVersions: [1, 2] as const, dotsIndividualPlayerCounts: [1, 2, 3, 4] as const }),
    internalGamesSupported: scenario !== 'old-api', wolfRulesVersions: scenario === 'old-api' ? [1] : [1, 2],
    permissions: { role: 'public', writePlayerIds: ids, canManageGames: false, canManageInternalGames: scenario !== 'old-api' },
    gameInputContext: { courseVersionId: dotsFixture.snapshot.courseVersionId, teeProfileId: dotsFixture.snapshot.teeProfile.id } };
  const rotating: DotsGameDefinition = { id: strokeGameId(962), name: 'Fictional rotating Dots', kind: 'dots',
    version: 2, mode: 'rotating', rotationHoles: scenario === 'rotating-6' ? 6 : 3,
    ...(scenario === 'rotating-high-low' ? { highLow: { version: 1 as const, handicapRule: 'group-low-v1' as const } } : {}),
    groupNumber: 1, playerIds: dotsPlayers, stakeMinor: 50,
    specials: scenario === 'rotating-high-low' ? [] : [...(['sandy', 'hogan', 'seve', 'pully', 'dime', 'super-dime', 'murphy', 'chippy', 'walk'] as const)
      .map((kind) => ({ kind, units: 1 })), { kind: 'birdie', units: 2 }] };
  const modern: DotsGameDefinition = { id: strokeGameId(963), name: 'Fictional current Dots', kind: 'dots', version: 1,
    ...(categorySweeps ? { mode: 'fixed', partnerIds: dotsPlayers } : { mode: 'individual' }),
    groupNumber: 1, playerIds: dotsPlayers, stakeMinor: null,
    ...(scenario === 'manual-sweep' ? { sweepRule: 'manual-v1' as const } : {}),
    specials: pullyTargets ? [{ kind: 'pully-murphy', units: 1 }]
      : coexistence ? (['hogan', 'seve', 'chippy', 'pully', 'sandy', 'gorilla', 'kp', 'blue-plate', 'long-drive'] as const)
      .map((kind) => ({ kind, units: 1 }))
      : scenario === 'manual-sweep' ? [{ kind: 'sweep', units: 2 }]
      : categorySweeps ? [{ kind: 'long-drive', units: 1 }, { kind: 'blue-plate', units: 1 }]
      : scenario === 'string-rules' ? [{ kind: 'string', units: 1 }, { kind: 'birdy-string', units: 3 },
      { kind: 'birdie', units: 2 }, { kind: 'eagle', units: 4 }]
      : [{ kind: 'paree', units: 1 }, { kind: 'murphy', units: 1 }, { kind: 'sandy', units: 1 }, { kind: 'pully', units: 1 }] };
  let stored = project(initial, firstTee ? [dotsFixture.skins, { ...wolf, orderMode: 'first-tee-v1' as const }]
    : modernRules ? [modern] : scenario.startsWith('rotating') ? [dotsFixture.skins, rotating]
    : scenario === 'setup' || scenario === 'setup-high-low' || scenario === 'setup-sweep' || scenario.startsWith('individual-') ? [dotsFixture.skins] : [dotsFixture.skins, wolf, dots], snapshot);
  const wireRound = (round: RoundScores) => leanRoundScores(round, sweepRules, sweepRules, modernRules || sweepRules,
    scenario === 'called-targets' || pullyTargets || sweepRules, categorySweeps || sweepRules, sweepRules, sweepRules,
    false, false, pullyTargets, wolfOrders, highLow);
  const wireWrite = (result: ScoreWriteResult) => leanScoreWriteResult(result, sweepRules, sweepRules, modernRules || sweepRules,
    scenario === 'called-targets' || pullyTargets || sweepRules, categorySweeps || sweepRules, sweepRules, sweepRules,
    false, false, pullyTargets, wolfOrders, highLow);
  let writes = 0, configWrites = 0, failPaused = false, roundReads = 0;
  const roundReadFormats: string[] = [];
  let releaseFailure: (() => void) | null = null;
  const requests: { readonly id: string; readonly playerId: string; readonly etag: string | null; readonly score: HoleScore }[] = [];
  const configurations: (readonly RoundGameDefinition[])[] = [];
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => { pageErrors.push(error.message); });
  expect(isRoundScores(stored)).toBe(true);
  expect(isEventWorkspace(workspace(stored, snapshot))).toBe(true);
  try {
    await server.listen();
    const address = server.httpServer?.address();
    if (!address || typeof address === 'string') throw new Error('Fictional Dots server unavailable');
    const origin = `http://127.0.0.1:${String(address.port)}`;
    await page.route(`${origin}/`, (route) => route.fulfill({ contentType: 'text/html',
      body: '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="public-app-fixture"></div><script type="module" src="/tests/smoke/public-app-fixture.tsx"></script></body></html>' }));
    await page.route(`${origin}/__public-api/**`, async (route) => {
      const request = route.request(), headers = request.headers();
      expect(headers.authorization).toBeUndefined();
      const path = new URL(request.url()).pathname.replace('/__public-api/public/', '');
      if (request.method() === 'GET') {
        if (path === 'events') return route.fulfill({ json: { events: [workspace(stored, snapshot).event] } });
        if (path.endsWith('/workspace')) return route.fulfill({ json: workspace(stored, snapshot) });
        if (path.endsWith('/scores')) {
          roundReads++;
          const lean = new URL(request.url()).searchParams.get('format') === 'lean';
          roundReadFormats.push(lean ? 'lean' : 'full');
          if (modernRules || sweepRules) expect(new URL(request.url()).searchParams.get('stringRules')).toBe('2');
          if (categorySweeps) expect(new URL(request.url()).searchParams.get('categorySweeps')).toBe('1');
          if (sweepRules) expect(new URL(request.url()).searchParams.get('sweepRules')).toBe('2');
          if (coexistence) expect(new URL(request.url()).searchParams.get('dotCoexistence')).toBe('2');
          if (highLow) expect(new URL(request.url()).searchParams.get('dotsHighLow')).toBe('1');
          if (wolfOrders) expect(new URL(request.url()).searchParams.get('wolfOrders')).toBe('1');
          return route.fulfill({ json: lean && !coexistence ? wireRound(stored) : stored });
        }
        throw new Error(`Unexpected fictional Dots read: ${path}`);
      }
      const payload: unknown = request.postDataJSON();
      const id = headers['idempotency-key'], expectedEtag = headers['if-match'] ?? null;
      if (request.method() !== 'PUT' || !isRecord(payload) || !id) throw new Error('Missing conditional fictional Dots request');
      if (!path.includes('/holes/') && path.endsWith('/games')) {
        if (!isRoundGameDefinitions(payload.games) || !stored.games) throw new Error('Invalid fictional Dots configuration');
        expect(stored.quickRound).not.toBe(true);
        expect(stored.permissions?.canManageGames).toBe(false);
        expect(stored.permissions?.canManageInternalGames).toBe(true);
        expect(expectedEtag).toBe(stored.games.configuration.etag);
        expect(payload.games.find((game) => game.id === dotsFixture.skins.id)).toEqual(dotsFixture.skins);
        const before = stored.games.configuration.games;
        configurations.push(payload.games);
        stored = project({ ...stored, games: { ...stored.games, configuration: { ...stored.games.configuration,
          etag: `fictional-dots-games-v${String(++configWrites + 1)}` } } }, payload.games, snapshot);
        const result: GameWriteResult = { round: stored, change: { id, eventId: stored.eventId, roundId: stored.roundId,
          expectedEtag, before, after: payload.games, recordedAt: '2026-01-01T00:00:00Z',
          recordedBy: { kind: 'public-score', eventId: stored.eventId } } };
        expect(isRoundScores(stored)).toBe(true);
        return route.fulfill({ json: new URL(request.url()).searchParams.get('format') === 'lean'
          ? { ...result, round: wireRound(result.round) } : result });
      }
      if (!isHoleScore(payload.score)) throw new Error('Invalid fictional Dots score request');
      const parts = path.split('/'), playerId = parts[5], holeNumber = Number(parts[7]);
      const card = stored.cards.find((entry) => entry.playerId === playerId);
      const before = card?.holes.find((hole) => hole.number === holeNumber)?.score;
      if (!card || !before) throw new Error('Unknown fictional Dots score target');
      expect(expectedEtag).toBe(card.etag);
      if (card.etag === null) expect(headers['if-none-match']).toBe('*');
      requests.push({ id, playerId: card.playerId, etag: expectedEtag, score: payload.score });
      if (failPaused) {
        failPaused = false;
        await new Promise<void>((resolve) => { releaseFailure = resolve; });
        return route.fulfill({ status: 503, json: { message: 'Fictional interrupted Dots acknowledgement' } });
      }
      const after = preserveScoreExtras(payload.score, before);
      const recordedAt = '2026-01-01T00:00:00Z';
      stored = project({ ...stored, setupLocked: true, lastUpdatedAt: recordedAt,
        permissions: { role: 'public', writePlayerIds: ids, canManageGames: false, canManageInternalGames: false },
        cards: stored.cards.map((entry) => entry.playerId === card.playerId ? { ...entry,
          etag: `fictional-dots-card-v${String(++writes)}`, updatedAt: recordedAt,
          holes: entry.holes.map((hole) => hole.number === holeNumber ? { ...hole, score: after } : hole),
        } : entry) }, undefined, snapshot);
      const result: ScoreWriteResult = { round: stored, change: { id, eventId: stored.eventId, roundId: stored.roundId,
        playerId: card.playerId, holeNumber, before, after, expectedEtag, recordedAt,
        recordedBy: { kind: 'public-score', eventId: stored.eventId } } };
      expect(isScoreWriteResult(result)).toBe(true);
      return route.fulfill({ json: new URL(request.url()).searchParams.get('format') === 'lean'
        ? coexistence ? result : wireWrite(result) : result });
    });
    await page.goto(`${origin}/#events?event=${stored.eventId}&round=${stored.roundId}`);
    await expect(page.getByRole('form', { name: `Group 1 hole ${firstTee ? '5' : '1'} entry`, exact: true })).toBeVisible();
    return { close: () => server.close(), read: () => stored,
      counters: () => ({ writes, configWrites, requests, configurations, pageErrors, roundReads, roundReadFormats }),
      pauseNextFailure() { failPaused = true; },
      releaseFailure() {
        if (!releaseFailure) throw new Error('No fictional Dots request is paused');
        releaseFailure();
        releaseFailure = null;
      } };
  } catch (error) { await server.close(); throw error; }
}
