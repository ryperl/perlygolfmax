import { createServer } from 'vite';
import type { Page, TestInfo } from '@playwright/test';
import { expect } from './test';
import { isRecord } from '../../src/contracts/events';
import { isRoundGameDefinitions } from '../../src/contracts/games';
import { leanRoundScores, leanScoreWriteResult } from '../../src/contracts/lean-round-scores';
import { decodeRoundScores, isGameWriteResult, isHoleScore, isRoundScores, isScoreWriteResult } from '../../src/contracts/scoring';
import { isEventWorkspace } from '../../src/contracts/setup';
import { churchyV3Records, churchyV3RecordsMatchGame, defaultChurchySpecialSelections } from '../../src/domain/churchy';
import type { ChurchyGameDefinitionV3 } from '../../src/domain/churchy';
import { dotsSpecialCatalog } from '../../src/domain/dots';
import type { RoundGameDefinition } from '../../src/domain/games';
import { calculateInternalSettlements } from '../../src/domain/internal-games';
import { preserveScoreExtras } from '../../src/domain/scoring';
import type { GameWriteResult, HoleScore, RoundScores, ScoreWriteResult } from '../../src/domain/scoring';
import type { EventWorkspace } from '../../src/domain/setup';
import { calculateGameResults } from '../../src/domain/stableford';
import { strokeGameFixture, strokeGameId, strokeGamesRound } from '../../src/domain/stroke-games.test-support';

const source = strokeGameFixture(18, 8);
const snapshot = { ...source.snapshot, groups: source.snapshot.groups.map((group) =>
  ({ ...group, startingHole: group.number === 1 ? 10 : 1 })) };
export const churciePlayers = source.cards.map((card) => card.playerId);
const games: readonly ChurchyGameDefinitionV3[] = snapshot.groups.map((group) => ({
  id: strokeGameId(980 + group.number), name: 'Churchie', kind: 'churchy', version: 3,
  groupNumber: group.number, playerIds: group.playerIds, basis: 'net', currency: 'USD',
  amountPerDotMinor: 50, orderMode: group.number === 1 ? 'approach' : 'tee',
  specials: defaultChurchySpecialSelections,
}));

function project(round: RoundScores, definitions = round.games?.configuration.games ?? []): RoundScores {
  const results = calculateGameResults(definitions, snapshot, round.cards);
  return { ...round, games: {
    configuration: { eventId: round.eventId, roundId: round.roundId,
      etag: round.games?.configuration.etag ?? 'fictional-churcie-games-v1', games: definitions },
    results,
  }, internalSettlements: calculateInternalSettlements(definitions, results, round) };
}

function workspace(round: RoundScores): EventWorkspace {
  return { event: { id: round.eventId, name: round.eventName, role: 'viewer', status: 'active',
    etag: 'fictional-churcie-event-v1', createdAt: '2026-01-01T00:00:00Z' },
  etag: 'fictional-churcie-event-v1', location: 'Fictional location', publicAccess: true, canViewScores: true,
  roster: round.cards.map(({ playerId, displayName }) => ({ playerId, displayName, handicapIndexValue: '0' })),
  rounds: [{ ...snapshot, scoringStarted: round.setupLocked,
    players: round.cards.map(({ playerId, displayName }) => ({ playerId, displayName, handicapIndexValue: '0' })) }] };
}

export async function openChurcieV3Fixture(page: Page, testInfo: TestInfo,
  scenario: 'configured' | 'setup' | 'other-group-started' | 'old-api' | 'murphy-targets' | 'score-targets' = 'configured') {
  const server = await createServer({ configFile: false, cacheDir: testInfo.outputPath('vite-cache'),
    server: { host: '127.0.0.1', port: 0, hmr: false }, esbuild: { jsx: 'automatic' },
    optimizeDeps: { noDiscovery: true, include: ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime'] },
    logLevel: 'error' });
  const base = strokeGamesRound({ ...source, snapshot });
  const started = scenario === 'other-group-started';
  let stored = project({ ...base, setupLocked: started, lastUpdatedAt: started ? '2026-01-01T00:00:00Z' : null,
    teeStrokeAllocation: true,
    cards: base.cards.map((card, index) => ({ ...card,
      etag: started && index === 4 ? 'fictional-started-card' : null,
      updatedAt: started && index === 4 ? '2026-01-01T00:00:00Z' : null,
      holes: card.holes.map((hole) => ({ ...hole, score: started && index === 4 && hole.number === 1
        ? { kind: 'strokes', strokes: 4 } : { kind: 'unplayed' } })) })),
    supportedGameKinds: ['churchy', 'dots', 'wolf', 'ball-drop'], churchyEnabled: true,
    churchyRulesVersions: scenario === 'old-api' ? [1, 2] : [1, 2, 3],
    ...(scenario === 'murphy-targets' || scenario === 'score-targets' ? { churchyMurphyTargets: true as const } : {}),
    ...(scenario === 'score-targets' ? { churchyPareeTargets: true as const } : {}),
    dotsRulesVersions: [1, 2], dotsSpecialKinds: dotsSpecialCatalog.map((entry) => entry.kind),
    internalGamesSupported: true, wolfRulesVersions: [1, 2],
    permissions: { role: 'public', writePlayerIds: churciePlayers, canManageGames: false, canManageInternalGames: !started },
    gameInputContext: { courseVersionId: snapshot.courseVersionId, teeProfileId: snapshot.teeProfile.id },
  }, [source.ballDrop, ...(scenario === 'setup' || scenario === 'old-api' ? [] : games)]);
  let writes = 0, configWrites = 0, failed = false, reads = 0;
  const requests: { readonly id: string; readonly playerId: string; readonly holeNumber: number; readonly score: HoleScore }[] = [];
  const configurations: (readonly RoundGameDefinition[])[] = [];
  const pageErrors: string[] = [];
  const receipts = new Map<string, { readonly result: ScoreWriteResult; readonly score: HoleScore }>();
  const configReceipts = new Map<string, GameWriteResult>();
  page.on('pageerror', (error) => { pageErrors.push(error.message); });
  function lean(round: RoundScores) {
    expect(isRoundScores(round)).toBe(true);
    const wire = leanRoundScores(round, scenario === 'murphy-targets' || scenario === 'score-targets', scenario === 'score-targets');
    expect(decodeRoundScores(wire)).toEqual(round);
    for (const result of wire.round.games?.results ?? []) {
      if (result.churchy) {
        expect(Object.hasOwn(result.churchy, 'awards')).toBe(false);
        for (const hole of result.churchy.holes) expect(Object.hasOwn(hole, 'specials')).toBe(false);
      }
    }
    return wire;
  }
  lean(stored);
  expect(isEventWorkspace(workspace(stored))).toBe(true);
  try {
    await server.listen();
    const address = server.httpServer?.address();
    if (!address || typeof address === 'string') throw new Error('Fictional Churchie server unavailable.');
    const origin = `http://127.0.0.1:${String(address.port)}`;
    await page.route(`${origin}/`, (route) => route.fulfill({ contentType: 'text/html',
      body: '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="public-app-fixture"></div><script type="module" src="/tests/smoke/public-app-fixture.tsx"></script></body></html>' }));
    await page.route(`${origin}/__public-api/**`, async (route) => {
      const request = route.request(), headers = request.headers(), url = new URL(request.url());
      expect(headers.authorization).toBeUndefined();
      const path = url.pathname.replace('/__public-api/public/', '');
      if (request.method() === 'GET') {
        if (path === 'events') return route.fulfill({ json: { events: [workspace(stored).event] } });
        if (path.endsWith('/workspace')) return route.fulfill({ json: workspace(stored) });
        if (path.endsWith('/scores')) {
          expect(url.searchParams.get('format')).toBe('lean');
          reads++;
          return route.fulfill({ json: lean(stored) });
        }
        throw new Error(`Unexpected fictional Churchie read: ${path}`);
      }
      const payload: unknown = request.postDataJSON();
      const id = headers['idempotency-key'], expectedEtag = headers['if-match'] ?? null;
      if (request.method() !== 'PUT' || !isRecord(payload) || !id) throw new Error('Missing conditional fictional Churchie request.');
      expect(url.searchParams.get('format')).toBe('lean');
      if (!path.includes('/holes/') && path.endsWith('/games')) {
        if (!isRoundGameDefinitions(payload.games) || !stored.games) throw new Error('Invalid fictional Churchie configuration.');
        const replay = configReceipts.get(id);
        if (replay) {
          expect(payload.games).toEqual(replay.change.after);
          return route.fulfill({ json: { ...replay, round: lean(stored) } });
        }
        expect(stored.setupLocked).toBe(false);
        expect(stored.permissions?.canManageInternalGames).toBe(true);
        expect(expectedEtag).toBe(stored.games.configuration.etag);
        expect(payload.games.find((game) => game.id === source.ballDrop.id)).toEqual(source.ballDrop);
        const before = stored.games.configuration.games;
        configurations.push(payload.games);
        stored = project({ ...stored, games: { ...stored.games, configuration: { ...stored.games.configuration,
          etag: `fictional-churcie-games-v${String(++configWrites + 1)}` } } }, payload.games);
        const result: GameWriteResult = { round: stored, change: { id, eventId: stored.eventId, roundId: stored.roundId,
          expectedEtag, before, after: payload.games, recordedAt: '2026-01-01T00:00:00Z',
          recordedBy: { kind: 'public-score', eventId: stored.eventId } } };
        expect(isGameWriteResult(result)).toBe(true);
        configReceipts.set(id, result);
        return route.fulfill({ json: { ...result, round: lean(stored) } });
      }
      if (!isHoleScore(payload.score)) throw new Error('Invalid fictional Churchie score.');
      const parts = path.split('/'), playerId = parts[5], holeNumber = Number(parts[7]);
      const card = stored.cards.find((entry) => entry.playerId === playerId);
      const before = card?.holes.find((hole) => hole.number === holeNumber)?.score;
      if (!card || !before) throw new Error('Unknown fictional Churchie target.');
      requests.push({ id, playerId: card.playerId, holeNumber, score: payload.score });
      const replay = receipts.get(id);
      if (replay) {
        expect(payload.score).toEqual(replay.score);
        expect(expectedEtag).toBe(replay.result.change.expectedEtag);
        expect(card.playerId).toBe(replay.result.change.playerId);
        expect(holeNumber).toBe(replay.result.change.holeNumber);
        return route.fulfill({ json: leanScoreWriteResult({ ...replay.result, round: stored },
          scenario === 'murphy-targets' || scenario === 'score-targets', scenario === 'score-targets') });
      }
      expect(expectedEtag).toBe(card.etag);
      if (card.etag === null) expect(headers['if-none-match']).toBe('*');
      if (failed) {
        failed = false;
        return route.fulfill({ status: 503, json: { message: 'Fictional interrupted Churchie acknowledgement.' } });
      }
      let after = preserveScoreExtras(payload.score, before);
      const declaration = after.churchy;
      if (declaration?.version === 3) {
        const game = stored.games?.configuration.games.find((entry): entry is ChurchyGameDefinitionV3 =>
          entry.kind === 'churchy' && entry.version === 3 && entry.id === declaration.gameId);
        if (!game) throw new Error('Unknown fictional Churchie game.');
        expect(game.groupNumber).toBe(stored.groups.find((group) => group.playerIds[0] === playerId)?.number);
        expect(declaration.gameEtag).toBe(stored.games?.configuration.etag);
        const receipt = churchyV3Records(game, stored.groups, stored.cards).find((entry) => entry.rotation);
        if (receipt?.rotation) {
          if (declaration.rotation) expect(declaration.rotation.playerIds).toEqual(receipt.rotation.playerIds);
          after = { ...after, churchy: { ...declaration, rotation: receipt.rotation } };
        } else if (declaration.rotation) {
          const late = stored.cards.some((entry) => game.playerIds.includes(entry.playerId)
            && entry.holes.some((hole) => hole.score.kind !== 'unplayed'));
          after = { ...after, churchy: { ...declaration, rotation: { playerIds: declaration.rotation.playerIds,
            ...(late ? { recordedLate: true as const } : {}) } } };
        }
      }
      const recordedAt = '2026-01-01T00:00:00Z';
      stored = project({ ...stored, setupLocked: true, lastUpdatedAt: recordedAt,
        permissions: { role: 'public', writePlayerIds: churciePlayers, canManageGames: false, canManageInternalGames: false },
        cards: stored.cards.map((entry) => entry.playerId === card.playerId ? { ...entry,
          etag: `fictional-churcie-card-v${String(++writes)}`, updatedAt: recordedAt,
          holes: entry.holes.map((hole) => hole.number === holeNumber ? { ...hole, score: after } : hole),
        } : entry) });
      for (const game of stored.games?.configuration.games ?? []) {
        if (game.kind === 'churchy' && game.version === 3) expect(churchyV3RecordsMatchGame(
          churchyV3Records(game, stored.groups, stored.cards), game, stored)).toBe(true);
      }
      const result: ScoreWriteResult = { round: stored, change: { id, eventId: stored.eventId, roundId: stored.roundId,
        playerId: card.playerId, holeNumber, before, after, expectedEtag, recordedAt,
        recordedBy: { kind: 'public-score', eventId: stored.eventId } } };
      expect(isScoreWriteResult(result)).toBe(true);
      const wire = leanScoreWriteResult(result, scenario === 'murphy-targets' || scenario === 'score-targets', scenario === 'score-targets');
      expect(isScoreWriteResult({ ...wire, round: decodeRoundScores(wire.round) })).toBe(true);
      lean(stored);
      receipts.set(id, { result, score: payload.score });
      return route.fulfill({ json: wire });
    });
    await page.goto(`${origin}/#events?event=${stored.eventId}&round=${stored.roundId}`);
    await expect(page.getByRole('form', { name: 'Group 1 hole 10 entry', exact: true })).toBeVisible();
    return { close: () => server.close(), read: () => stored,
      counters: () => ({ writes, configWrites, reads, requests, configurations, pageErrors }),
      simulateRemoteOpponentAward() {
        const game = games[0], first = game?.playerIds[0];
        if (!game || !first) throw new Error('Missing fictional remote Churchie target.');
        stored = project({ ...stored, setupLocked: true, lastUpdatedAt: '2026-01-02T00:00:00Z',
          permissions: { role: 'public', writePlayerIds: churciePlayers, canManageGames: false, canManageInternalGames: false },
          cards: stored.cards.map((card) => !game.playerIds.includes(card.playerId) ? card : { ...card,
            etag: `fictional-remote-${card.playerId}`, updatedAt: '2026-01-02T00:00:00Z',
            holes: card.holes.map((hole) => hole.number !== 10 ? hole : { ...hole,
              score: { kind: 'strokes', strokes: card.playerId === first ? 5 : 4,
                ...(card.playerId === first ? { churchy: { version: 3, gameId: game.id,
                  gameEtag: stored.games?.configuration.etag ?? '', number: 10,
                  rotation: { playerIds: [...game.playerIds].reverse() }, contests: [],
                  players: [{ playerId: first, counts: {}, calls: [{
                    id: strokeGameId(995), kind: 'murphy', result: 'failure', murphyPresses: 2,
                  }] }] } } : {}) },
            }) }),
        });
      },
      failNextAcknowledgement() { failed = true; } };
  } catch (error) { await server.close(); throw error; }
}
