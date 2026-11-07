import type { TableClient, TransactionAction } from '@azure/data-tables';
import type { AccountIdentity } from '../../../src/domain/events.js';
import type { ScoreActor } from '../../../src/domain/test-access.js';
import type { EventWorkspace, RoundPlayerSnapshot, RoundSnapshot } from '../../../src/domain/setup.js';
import type { GameWriteResult, HoleScore, RoundScores, Scorecard, ScoreChange, ScoreHistoryPage, ScoreWriteResult } from '../../../src/domain/scoring.js';
import type { GameChange, GameConfiguration, RoundGameDefinition } from '../../../src/domain/games.js';
import { gameTeamsMatchRoster, isStablefordGame, sameGameDefinitions } from '../../../src/domain/games.js';
import { maximumPrivateWriteBytes } from '../../../src/contracts/private-values.js';
import { calculateGameResults } from '../../../src/domain/stableford.js';
import { isGameChange, isRoundGameDefinitions } from '../../../src/contracts/games.js';
import { isEventRevision, isRecord, isUuid } from '../../../src/contracts/events.js';
import { isHoleScore, isScorecard, isScoreChange } from '../../../src/contracts/scoring.js';
import { sameHoleScore, sameScoreActor, scoreActor } from '../../../src/domain/scoring.js';
import { canonical, decode, isConflict, optionalRow, page, revision } from '../catalog/entities.js';
import { ApiError } from '../errors.js';
import type { TableWorkspaceStore } from '../setup/store.js';
import { scoringLock } from './lock.js';
import type { ScoringLock, StoredScoringLock } from './lock.js';
import { configuredGameRounds, gameChangeKey, gameConfigurationContent, gameConfigurationKey, readGameConfiguration } from './games.js';
import type { EventLeaderboardView } from '../../../src/domain/event-leaderboard.js';
import { calculateEventStandings } from '../../../src/domain/event-leaderboard.js';
import { privateContent, stagePrivateContent } from '../private-values.js';
import { receivePrivateWrite } from '../private-transport.js';
import { assertEventAccessUnchanged, readEventAccess } from '../event-access.js';
import type { EventAccess } from '../event-access.js';
import { publishedCourseHandicaps, publishedPlayingHandicaps } from '../../../src/domain/playing-handicaps.js';
import { activeTesterLink, testerLinkKey } from '../test-access/authority.js';

function cardKey(roundId: string, playerId: string): string {
  return `score-card:${roundId}:${playerId}`;
}

type StoredCard = Omit<Scorecard, 'etag'>;

function isStoredCard(value: unknown): value is StoredCard {
  return isRecord(value) && !('etag' in value) && isScorecard({ ...value, etag: 'validation-only' });
}

function projectChange(change: ScoreChange): ScoreChange {
  return {
    id: change.id, eventId: change.eventId, roundId: change.roundId, playerId: change.playerId,
    holeNumber: change.holeNumber, before: change.before, after: change.after, expectedEtag: change.expectedEtag,
    recordedAt: change.recordedAt,
    recordedBy: scoreActor(change.recordedBy),
  };
}

export class TableScoreStore {
  constructor(private readonly table: TableClient, private readonly workspace: TableWorkspaceStore) {}

  private async access(identity: ScoreActor, eventId: string, ownerOnly = false) {
    if (!isUuid(eventId)) throw new ApiError(400, 'INVALID_REQUEST_ID');
    const access = await readEventAccess(this.table, identity, eventId);
    if (access.summary.role !== 'owner' && (ownerOnly || !access.admittedPlayer && !access.testerLink && !access.publicAccess)) throw new ApiError(403, 'SCORES_OWNER_REQUIRED');
    return { ...access, gameRoundIds: configuredGameRounds(access.event.gameRoundIds) };
  }

  private async snapshot(identity: ScoreActor, eventId: string, roundId: string, ownerOnly = false) {
    if (!isUuid(roundId)) throw new ApiError(400, 'INVALID_REQUEST_ID');
    const access = await this.access(identity, eventId, ownerOnly);
    const workspace = await this.workspace.getForScoring(identity, eventId);
    if (access.summary.etag !== workspace.etag) throw new ApiError(409, 'EVENT_CHANGED');
    const round = workspace.rounds.find((entry) => entry.id === roundId);
    if (!round) throw new ApiError(404, 'ROUND_NOT_FOUND');
    if (access.gameRoundIds.some((id) => !workspace.rounds.some((entry) => entry.id === id))) throw new ApiError(503, 'INVALID_STORED_GAMES');
    const lock = await scoringLock(this.table, eventId, roundId);
    if ((round.scoringStarted === true) !== (lock !== undefined)) throw new ApiError(409, 'EVENT_CHANGED');
    const games = await readGameConfiguration(this.table, eventId, roundId, access.gameRoundIds);
    return { ...access, workspace, round, lock, games };
  }

  private async unchanged(identity: ScoreActor, eventId: string, before: EventAccess): Promise<void> {
    await assertEventAccessUnchanged(this.table, identity, eventId, before);
  }

  private writer(state: EventAccess & { readonly round: RoundSnapshot }, playerId?: string) {
    if (state.publicAccess) {
      if (!playerId) throw new ApiError(403, 'SCORES_OWNER_REQUIRED');
      return { etag: state.summary.etag, role: 'public' as const };
    }
    if (state.testerLink) {
      if (!playerId) throw new ApiError(403, 'SCORES_OWNER_REQUIRED');
      return { etag: revision(state.testerLink), role: 'tester' as const };
    }
    if (state.summary.role !== 'owner') {
      const group = state.round.groups.find((entry) => state.viewerPlayerId && entry.playerIds.includes(state.viewerPlayerId));
      if (!playerId || !state.viewerPlayerId || state.summary.role !== 'member' || !group?.playerIds.includes(playerId)) {
        throw new ApiError(403, 'GROUP_SCORE_PERMISSION_REQUIRED');
      }
    }
    if (!state.member || !state.memberEtag || (state.member.role !== 'owner' && state.member.role !== 'member')) {
      throw new ApiError(503, 'INVALID_SCORING_GRANT');
    }
    return { etag: state.memberEtag, role: state.summary.role };
  }

  private async card(eventId: string, round: RoundSnapshot, player: RoundPlayerSnapshot, writtenIds: ReadonlySet<string>): Promise<Scorecard> {
    const playerId = player.playerId;
    const row = await optionalRow(this.table, eventId, cardKey(round.id, playerId));
    const written = writtenIds.has(playerId);
    if (!row && written || row && !written) throw new ApiError(503, 'INVALID_STORED_SCORECARD');
    if (!row) return {
      playerId, displayName: player.displayName, etag: null, updatedAt: null,
      holes: round.teeProfile.holes.map((hole) => ({ number: hole.number, score: { kind: 'unplayed' } })),
    };
    const stored = decode(row.content, isStoredCard);
    const card: Scorecard = {
      playerId: stored.playerId, displayName: stored.displayName, etag: revision(row), updatedAt: stored.updatedAt,
      holes: stored.holes.map((hole) => ({ number: hole.number, score: hole.score })),
    };
    if (!round.scoringStarted || card.playerId !== playerId || card.displayName !== player.displayName
      || card.holes.length !== round.teeProfile.holes.length
      || !round.teeProfile.holes.every((hole) => card.holes.some((entry) => entry.number === hole.number))) {
      throw new ApiError(503, 'INVALID_STORED_SCORECARD');
    }
    return card;
  }

  private async projection(capturedWorkspace: EventWorkspace, capturedRound: RoundSnapshot, capturedCards: readonly Scorecard[], access: EventAccess, games?: GameConfiguration): Promise<RoundScores> {
    const workspace = await this.workspace.forDisplay(capturedWorkspace);
    const round = workspace.rounds.find((item) => item.id === capturedRound.id);
    if (!round) throw new ApiError(503, 'INVALID_STORED_WORKSPACE');
    const names = new Map(round.players.map((player) => [player.playerId, player.displayName]));
    const cards = capturedCards.map((card) => {
      const displayName = names.get(card.playerId);
      if (displayName === undefined) throw new ApiError(503, 'INVALID_STORED_SCORECARD');
      return { ...card, displayName };
    });
    const timestamps = cards.flatMap((card) => card.updatedAt === null ? [] : [card.updatedAt]).sort();
    const owner = access.summary.role === 'owner';
    const viewerPlayerId = round.players.some((player) => player.playerId === access.viewerPlayerId) ? access.viewerPlayerId : undefined;
    const ownGroup = round.groups.find((group) => viewerPlayerId && group.playerIds.includes(viewerPlayerId));
    const active = workspace.event.status === 'active';
    const competition = workspace.overallCompetition;
    return {
      eventId: workspace.event.id, eventName: workspace.event.name, eventStatus: workspace.event.status,
      roundId: round.id, roundName: round.name, courseName: round.course.name,
      teeName: round.teeProfile.name, teeCategory: round.teeProfile.category, layout: round.teeProfile.holes,
      ...(round.playerTees?.length ? { playerTees: round.playerTees } : {}),
      teeRatings: round.teeProfile.ratings.map((rating) => ({
        type: rating.type, course: rating.course, slope: rating.slope, bogey: rating.bogey,
      })),
      groups: round.groups, cards, setupLocked: round.scoringStarted === true,
      courseHandicaps: publishedCourseHandicaps(capturedRound),
      permissions: { role: access.publicAccess ? 'public' : access.testerLink ? 'tester' : owner ? 'owner' : viewerPlayerId ? 'player' : 'viewer',
        ...(viewerPlayerId ? { viewerPlayerId } : {}),
        writePlayerIds: !active ? [] : owner || access.testerLink || access.publicAccess ? round.players.map((player) => player.playerId) : ownGroup?.playerIds ?? [],
        canManageGames: owner && active },
      ...(competition?.kind === 'stroke-play' && competition.basis === 'net'
        ? { overallHandicaps: publishedPlayingHandicaps(round, competition.handicapAllowancePercent) } : {}),
      lastUpdatedAt: timestamps.at(-1) ?? null,
      ...(games ? { games: { configuration: games, results: calculateGameResults(games.games, round, cards) } } : {}),
    };
  }

  private async cards(eventId: string, round: RoundSnapshot, lock: StoredScoringLock | undefined): Promise<readonly Scorecard[]> {
    const cards: Scorecard[] = [];
    const written = new Set(lock?.writtenPlayerIds);
    for (let index = 0; index < round.players.length; index += 16) {
      cards.push(...await Promise.all(round.players.slice(index, index + 16).map((player) => this.card(eventId, round, player, written))));
    }
    return cards;
  }

  async get(identity: ScoreActor, eventId: string, roundId: string): Promise<RoundScores> {
    const state = await this.snapshot(identity, eventId, roundId);
    const cards = await this.cards(eventId, state.round, state.lock);
    const projection = await this.projection(state.workspace, state.round, cards, state, state.games);
    await this.unchanged(identity, eventId, state);
    return projection;
  }

  async leaderboard(identity: ScoreActor, eventId: string, chargeRead: () => Promise<void>): Promise<EventLeaderboardView> {
    const access = await this.access(identity, eventId);
    const workspace = await this.workspace.get(identity, eventId);
    if (workspace.etag !== access.summary.etag) throw new ApiError(409, 'EVENT_CHANGED');
    const roundScores: RoundScores[] = [];
    if (workspace.overallCompetition) {
      for (let index = 0; index < workspace.rounds.length; index += 3) {
        const batch = await Promise.all(workspace.rounds.slice(index, index + 3).map(async (round) => {
          await chargeRead();
          return this.get(identity, eventId, round.id);
        }));
        roundScores.push(...batch);
      }
    }
    await this.unchanged(identity, eventId, access);
    return { workspace, roundScores, standings: calculateEventStandings(workspace, roundScores) };
  }

  private async gameReceipt(eventId: string, roundId: string, requestId: string): Promise<GameChange | undefined> {
    const row = await optionalRow(this.table, eventId, gameChangeKey(roundId, requestId));
    if (!row) return undefined;
    const change = decode(await privateContent(this.table, eventId, gameChangeKey(roundId, requestId), row.content), isGameChange);
    if (row.kind !== 'game-change' || row.roundId !== roundId || change.eventId !== eventId
      || change.roundId !== roundId || change.id !== requestId) throw new ApiError(503, 'INVALID_STORED_GAMES');
    return change;
  }

  private async gameAcknowledgement(identity: AccountIdentity, change: GameChange): Promise<GameWriteResult> {
    for (let attempt = 0; ; attempt++) {
      try {
        const round = await this.get(identity, change.eventId, change.roundId);
        if (!round.games) throw new ApiError(503, 'INVALID_STORED_GAMES');
        return { round, change };
      } catch (error) {
        if (attempt < 2 && error instanceof ApiError && error.code === 'EVENT_CHANGED') continue;
        throw error;
      }
    }
  }

  private async replayGames(identity: AccountIdentity, eventId: string, roundId: string,
    games: readonly RoundGameDefinition[], expectedEtag: string | null, requestId: string): Promise<GameWriteResult | undefined> {
    const change = await this.gameReceipt(eventId, roundId, requestId);
    if (!change) return undefined;
    if (change.expectedEtag !== expectedEtag || change.recordedBy.tenantId !== identity.tenantId
      || change.recordedBy.objectId !== identity.objectId || canonical(change.after) !== canonical(games)) {
      throw new ApiError(409, 'GAME_REQUEST_CONFLICT');
    }
    const result = await this.gameAcknowledgement(identity, change);
    if (result.round.eventStatus !== 'active') throw new ApiError(409, 'EVENT_ARCHIVED');
    return result;
  }

  async saveGames(identity: AccountIdentity, eventId: string, roundId: string, games: readonly RoundGameDefinition[],
    expectedEtag: string | null, requestId: string): Promise<GameWriteResult> {
    if (!isUuid(requestId) || !isRoundGameDefinitions(games) || games.length === 0
      || expectedEtag !== null && !isEventRevision(expectedEtag)) throw new ApiError(400, 'INVALID_GAME_SETUP');
    if (Buffer.byteLength(JSON.stringify({ games }), 'utf8') > maximumPrivateWriteBytes) {
      throw new ApiError(413, 'REQUEST_TOO_LARGE');
    }
    const state = await this.snapshot(identity, eventId, roundId, true);
    const grant = this.writer(state);
    if (state.summary.status !== 'active') throw new ApiError(409, 'EVENT_ARCHIVED');
    const replay = await this.replayGames(identity, eventId, roundId, games, expectedEtag, requestId);
    if (replay) return replay;
    const competition = state.workspace.overallCompetition;
    if (competition?.kind === 'stableford' && competition.roundGames.some((binding) => binding.roundId === roundId
      && !games.some((game) => game.id === binding.gameId && isStablefordGame(game)))) {
      throw new ApiError(400, 'INVALID_OVERALL_GAME');
    }
    // Unchanged stale peers must survive while their assignments are repaired one game at a time.
    if (games.some((game) => {
      const previous = state.games?.games.find((saved) => saved.id === game.id);
      return !gameTeamsMatchRoster(game, state.round.players.map((player) => player.playerId))
        && (!previous || !sameGameDefinitions([game], [previous]));
    })) {
      throw new ApiError(400, 'INVALID_GAME_TEAMS');
    }
    const before = state.games;
    if ((before?.etag ?? null) !== expectedEtag) throw new ApiError(409, 'GAMES_CHANGED');
    if (before?.games.some((saved) => !games.some((game) => game.id === saved.id))) throw new ApiError(409, 'GAME_REMOVAL_NOT_SUPPORTED');
    const recordedAt = new Date().toISOString();
    const actor = { tenantId: identity.tenantId, objectId: identity.objectId };
    const change: GameChange = {
      id: requestId, eventId, roundId, expectedEtag, before: before?.games ?? [], after: games,
      recordedAt, recordedBy: actor,
    };
    const configuredRounds = state.gameRoundIds.includes(roundId) ? state.gameRoundIds : [...state.gameRoundIds, roundId];
    const entity = {
      partitionKey: eventId, rowKey: gameConfigurationKey(roundId), kind: 'round-games', schemaVersion: 1,
      content: await stagePrivateContent(this.table, eventId, gameConfigurationKey(roundId), identity, canonical(gameConfigurationContent(eventId, roundId, games))),
    };
    const changeContent = await stagePrivateContent(this.table, eventId, gameChangeKey(roundId, requestId), identity, canonical(change));
    try {
      await this.table.submitTransaction([
        ['update', { partitionKey: eventId, rowKey: 'event', gameRoundIds: canonical(configuredRounds) }, 'Merge', { etag: state.summary.etag }],
        ['update', {
          partitionKey: eventId, rowKey: `member:${identity.objectId}`, ...actor, role: 'owner',
        }, 'Merge', { etag: grant.etag }],
        expectedEtag === null ? ['create', entity] : ['update', entity, 'Replace', { etag: expectedEtag }],
        ['create', { partitionKey: eventId, rowKey: gameChangeKey(roundId, requestId), kind: 'game-change', roundId, content: changeContent }],
      ]);
    } catch (error) {
      const committed = await this.replayGames(identity, eventId, roundId, games, expectedEtag, requestId);
      if (committed) return committed;
      if (isConflict(error)) throw new ApiError(409, 'GAMES_CHANGED');
      throw error;
    }
    return this.gameAcknowledgement(identity, change);
  }

  async receiveGames(identity: AccountIdentity, eventId: string, roundId: string, body: unknown, expected: string | null, requestId: string) {
    if (!isUuid(roundId) || !isUuid(requestId)) throw new ApiError(400, 'INVALID_REQUEST_ID');
    const state = await this.access(identity, eventId, true);
    if (state.summary.status !== 'active') throw new ApiError(409, 'EVENT_ARCHIVED');
    if (!await optionalRow(this.table, eventId, `round:${roundId}`)) throw new ApiError(404, 'ROUND_NOT_FOUND');
    // Parts are inactive. Check the head revision without repeatedly decoding a large configuration.
    // The final save validates the complete captured workspace and games again.
    const head = await optionalRow(this.table, eventId, gameConfigurationKey(roundId));
    if ((head ? revision(head) : null) !== expected) {
      const receipt = await this.gameReceipt(eventId, roundId, requestId);
      if (!receipt || receipt.expectedEtag !== expected || receipt.recordedBy.tenantId !== identity.tenantId
        || receipt.recordedBy.objectId !== identity.objectId) throw new ApiError(409, 'GAMES_CHANGED');
    }
    return receivePrivateWrite(this.table, identity, eventId, `round-games:${roundId}`, expected, requestId, body);
  }

  private async receipt(eventId: string, requestId: string): Promise<ScoreChange | undefined> {
    const row = await optionalRow(this.table, eventId, `score-change:${requestId}`);
    if (!row) return undefined;
    const change = decode(row.content, isScoreChange);
    if (row.kind !== 'score-change' || row.roundId !== change.roundId || row.playerId !== change.playerId
      || change.eventId !== eventId || change.id !== requestId) throw new ApiError(503, 'INVALID_STORED_SCORE_CHANGE');
    return projectChange(change);
  }

  private async acknowledgement(identity: ScoreActor, change: ScoreChange): Promise<ScoreWriteResult> {
    // A later valid edit must not turn an acknowledged write into a stale-create failure.
    for (let attempt = 0; ; attempt++) {
      try {
        const round = await this.get(identity, change.eventId, change.roundId);
        const target = round.cards.find((card) => card.playerId === change.playerId);
        if (!target || target.etag === null || !round.setupLocked) throw new ApiError(503, 'INVALID_STORED_SCORECARD');
        return { round, change };
      } catch (error) {
        if (attempt < 2 && error instanceof ApiError && error.code === 'EVENT_CHANGED') continue;
        throw error;
      }
    }
  }

  private async replay(identity: ScoreActor, eventId: string, roundId: string, playerId: string,
    holeNumber: number, score: HoleScore, expectedEtag: string | null, requestId: string): Promise<ScoreWriteResult | undefined> {
    const change = await this.receipt(eventId, requestId);
    if (!change) return undefined;
    if (change.roundId !== roundId || change.playerId !== playerId || change.holeNumber !== holeNumber
      || change.expectedEtag !== expectedEtag || !sameScoreActor(change.recordedBy, identity) || !sameHoleScore(change.after, score)) {
      throw new ApiError(409, 'SCORE_REQUEST_CONFLICT');
    }
    const result = await this.acknowledgement(identity, change);
    if (result.round.eventStatus !== 'active') throw new ApiError(409, 'EVENT_ARCHIVED');
    return result;
  }

  async write(identity: ScoreActor, eventId: string, roundId: string, playerId: string, holeNumber: number,
    score: HoleScore, expectedEtag: string | null, requestId: string): Promise<ScoreWriteResult> {
    if (!isUuid(requestId) || !isUuid(playerId) || !isHoleScore(score) || !Number.isSafeInteger(holeNumber)
      || expectedEtag !== null && !isEventRevision(expectedEtag)) throw new ApiError(400, 'INVALID_SCORE_WRITE');
    const state = await this.snapshot(identity, eventId, roundId);
    if (state.summary.status !== 'active') throw new ApiError(409, 'EVENT_ARCHIVED');
    if (!state.round.teeProfile.holes.some((hole) => hole.number === holeNumber)) throw new ApiError(400, 'ROUND_HOLE_NOT_FOUND');
    if (!state.round.players.some((player) => player.playerId === playerId)) throw new ApiError(404, 'ROUND_PLAYER_NOT_FOUND');
    const grant = this.writer(state, playerId);
    const replay = await this.replay(identity, eventId, roundId, playerId, holeNumber, score, expectedEtag, requestId);
    if (replay) return replay;
    const cards = await this.cards(eventId, state.round, state.lock);
    const card = cards.find((entry) => entry.playerId === playerId);
    if (!card) throw new ApiError(503, 'INVALID_STORED_SCORECARD');
    if (card.etag !== expectedEtag) throw new ApiError(409, 'SCORECARD_CHANGED');
    const before = card.holes.find((hole) => hole.number === holeNumber);
    if (!before) throw new ApiError(503, 'INVALID_STORED_SCORECARD');
    const recordedAt = new Date().toISOString();
    const actor = scoreActor(identity);
    const change: ScoreChange = {
      id: requestId, eventId, roundId, playerId, holeNumber, before: before.score, after: score,
      expectedEtag, recordedAt, recordedBy: actor,
    };
    const updated: StoredCard = {
      playerId: card.playerId, displayName: card.displayName, updatedAt: recordedAt,
      holes: card.holes.map((hole) => hole.number === holeNumber ? { number: holeNumber, score } : hole),
    };
    const entity = { partitionKey: eventId, rowKey: cardKey(roundId, playerId), content: canonical(updated) };
    const actions: TransactionAction[] = [
      ['update', { partitionKey: eventId, rowKey: 'event', scoresUpdatedAt: recordedAt }, 'Merge', { etag: state.summary.etag }],
      expectedEtag === null ? ['create', entity] : ['update', entity, 'Replace', { etag: expectedEtag }],
      ['create', {
        partitionKey: eventId, rowKey: `score-change:${requestId}`, kind: 'score-change', roundId, playerId, content: canonical(change),
      }],
    ];
    // Public authority is the active event itself, already conditionally updated above.
    // Account and tester writes still check their actual independent grant in this transaction.
    if (!('kind' in identity) || identity.kind === 'tester-link') {
      actions.splice(1, 0, ['update', 'kind' in identity
        ? { partitionKey: eventId, rowKey: testerLinkKey(identity.linkId), scoreRevision: requestId }
        : { partitionKey: eventId, rowKey: `member:${identity.objectId}`, ...actor, role: grant.role },
      'Merge', { etag: grant.etag }]);
    }
    if (!state.lock) {
      const lock: ScoringLock = {
        kind: 'score-lock', eventId, roundId, requestId, startedAt: recordedAt, startedBy: actor, writtenPlayerIds: [playerId],
      };
      actions.push(['create', { partitionKey: eventId, rowKey: `score-lock:${roundId}`,
        content: await stagePrivateContent(this.table, eventId, `score-lock:${roundId}`, identity, canonical(lock)) }]);
    } else if (!state.lock.writtenPlayerIds.includes(playerId)) {
      const lock: ScoringLock = {
        kind: state.lock.kind, eventId, roundId, requestId: state.lock.requestId,
        startedAt: state.lock.startedAt, startedBy: state.lock.startedBy,
        writtenPlayerIds: [...state.lock.writtenPlayerIds, playerId],
      };
      actions.push(['update', {
        partitionKey: eventId, rowKey: `score-lock:${roundId}`,
        content: await stagePrivateContent(this.table, eventId, `score-lock:${roundId}`, identity, canonical(lock)),
      }, 'Replace', { etag: state.lock.etag }]);
    }
    // Staging a large lock may take time. Expiry is rechecked at the publication boundary.
    if ('kind' in identity && identity.kind === 'tester-link' && (!state.testerLink || !activeTesterLink(state.testerLink, identity))) {
      throw new ApiError(403, 'TESTER_ACCESS_ENDED');
    }
    try { await this.table.submitTransaction(actions); }
    catch (error) {
      // Transport failures may occur after commit; the immutable receipt is the authoritative acknowledgement.
      const committed = await this.replay(identity, eventId, roundId, playerId, holeNumber, score, expectedEtag, requestId);
      if (committed) return committed;
      if (isConflict(error)) throw new ApiError(409, 'SCORECARD_CHANGED');
      throw error;
    }
    return this.acknowledgement(identity, change);
  }

  async history(identity: ScoreActor, eventId: string, roundId: string, playerId: string, cursor?: string): Promise<ScoreHistoryPage> {
    if (!isUuid(playerId)) throw new ApiError(400, 'INVALID_REQUEST_ID');
    const state = await this.snapshot(identity, eventId, roundId, true);
    if (!state.round.players.some((player) => player.playerId === playerId)) throw new ApiError(404, 'ROUND_PLAYER_NOT_FOUND');
    const result = await page(this.table, `PartitionKey eq '${eventId}' and RowKey ge 'score-change:' and RowKey lt 'score-change;' and kind eq 'score-change' and roundId eq '${roundId}' and playerId eq '${playerId}'`, cursor);
    const changes = result.rows.map((row) => {
      const change = decode(row.content, isScoreChange);
      if (row.rowKey !== `score-change:${change.id}` || row.kind !== 'score-change'
        || row.roundId !== roundId || row.playerId !== playerId || change.eventId !== eventId
        || change.roundId !== roundId || change.playerId !== playerId
        || !state.round.teeProfile.holes.some((hole) => hole.number === change.holeNumber)) throw new ApiError(503, 'INVALID_STORED_SCORE_CHANGE');
      return projectChange(change);
    });
    await this.unchanged(identity, eventId, state);
    return { changes, ...(result.continuationToken ? { continuationToken: result.continuationToken } : {}) };
  }
}
