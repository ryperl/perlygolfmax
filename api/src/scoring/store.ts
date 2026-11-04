import type { TableClient, TransactionAction } from '@azure/data-tables';
import type { AccountIdentity } from '../../../src/domain/events.js';
import type { EventWorkspace, RoundSnapshot } from '../../../src/domain/setup.js';
import type { GameWriteResult, HoleScore, RoundScores, Scorecard, ScoreChange, ScoreHistoryPage, ScoreWriteResult } from '../../../src/domain/scoring.js';
import type { GameChange, GameConfiguration, RoundGameDefinition } from '../../../src/domain/games.js';
import { calculateGameResults } from '../../../src/domain/stableford.js';
import { isGameChange, isRoundGameDefinitions } from '../../../src/contracts/games.js';
import { isEventRevision, isEventSummary, isRecord, isUuid } from '../../../src/contracts/events.js';
import { isHoleScore, isScorecard, isScoreChange } from '../../../src/contracts/scoring.js';
import { sameHoleScore } from '../../../src/domain/scoring.js';
import { canonical, decode, isConflict, optionalRow, page, revision } from '../catalog/entities.js';
import { ApiError } from '../errors.js';
import type { TableWorkspaceStore } from '../setup/store.js';
import { scoringLock } from './lock.js';
import type { ScoringLock, StoredScoringLock } from './lock.js';
import { configuredGameRounds, gameChangeKey, gameConfigurationContent, gameConfigurationKey, readGameConfiguration } from './games.js';

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
    recordedBy: { tenantId: change.recordedBy.tenantId, objectId: change.recordedBy.objectId },
  };
}

export class TableScoreStore {
  constructor(private readonly table: TableClient, private readonly workspace: TableWorkspaceStore) {}

  private async access(identity: AccountIdentity, eventId: string) {
    if (!isUuid(eventId)) throw new ApiError(400, 'INVALID_REQUEST_ID');
    const member = await optionalRow(this.table, eventId, `member:${identity.objectId}`);
    if (!member || member.tenantId !== identity.tenantId || member.objectId !== identity.objectId) throw new ApiError(404, 'EVENT_NOT_FOUND');
    const event = await optionalRow(this.table, eventId, 'event');
    if (!event) throw new ApiError(404, 'EVENT_NOT_FOUND');
    const summary: unknown = {
      id: eventId, name: event.name, createdAt: event.createdAt,
      status: event.status === undefined ? 'active' : event.status, role: member.role, etag: revision(event),
    };
    if (!isEventSummary(summary)) throw new ApiError(503, 'INVALID_STORED_EVENT');
    if (summary.role !== 'owner') throw new ApiError(summary.status === 'archived' ? 404 : 403,
      summary.status === 'archived' ? 'EVENT_NOT_FOUND' : 'SCORES_OWNER_REQUIRED');
    return { summary, memberEtag: revision(member), gameRoundIds: configuredGameRounds(event.gameRoundIds) };
  }

  private async snapshot(identity: AccountIdentity, eventId: string, roundId: string) {
    if (!isUuid(roundId)) throw new ApiError(400, 'INVALID_REQUEST_ID');
    const access = await this.access(identity, eventId);
    const workspace = await this.workspace.get(identity, eventId);
    if (access.summary.etag !== workspace.etag) throw new ApiError(409, 'EVENT_CHANGED');
    const round = workspace.rounds.find((entry) => entry.id === roundId);
    if (!round) throw new ApiError(404, 'ROUND_NOT_FOUND');
    if (access.gameRoundIds.some((id) => !workspace.rounds.some((entry) => entry.id === id))) throw new ApiError(503, 'INVALID_STORED_GAMES');
    const lock = await scoringLock(this.table, eventId, roundId);
    if ((round.scoringStarted === true) !== (lock !== undefined)) throw new ApiError(409, 'EVENT_CHANGED');
    const games = await readGameConfiguration(this.table, eventId, roundId, access.gameRoundIds);
    return { ...access, workspace, round, lock, games };
  }

  private async unchanged(identity: AccountIdentity, eventId: string, etag: string, memberEtag: string): Promise<void> {
    const current = await this.access(identity, eventId);
    if (current.summary.etag !== etag || current.memberEtag !== memberEtag) throw new ApiError(409, 'EVENT_CHANGED');
  }

  private async card(eventId: string, round: RoundSnapshot, playerId: string, lock: StoredScoringLock | undefined): Promise<Scorecard> {
    const player = round.players.find((entry) => entry.playerId === playerId);
    if (!player) throw new ApiError(404, 'ROUND_PLAYER_NOT_FOUND');
    const row = await optionalRow(this.table, eventId, cardKey(round.id, playerId));
    const written = lock?.writtenPlayerIds.includes(playerId) === true;
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

  private projection(workspace: EventWorkspace, round: RoundSnapshot, cards: readonly Scorecard[], games?: GameConfiguration): RoundScores {
    const timestamps = cards.flatMap((card) => card.updatedAt === null ? [] : [card.updatedAt]).sort();
    return {
      eventId: workspace.event.id, eventName: workspace.event.name, eventStatus: workspace.event.status,
      roundId: round.id, roundName: round.name, courseName: round.course.name,
      teeName: round.teeProfile.name, teeCategory: round.teeProfile.category, layout: round.teeProfile.holes,
      teeRatings: round.teeProfile.ratings.map((rating) => ({
        type: rating.type, course: rating.course, slope: rating.slope, bogey: rating.bogey,
      })),
      groups: round.groups, cards, setupLocked: round.scoringStarted === true,
      lastUpdatedAt: timestamps.at(-1) ?? null,
      ...(games ? { games: { configuration: games, results: calculateGameResults(games.games, round, cards) } } : {}),
    };
  }

  async get(identity: AccountIdentity, eventId: string, roundId: string): Promise<RoundScores> {
    const state = await this.snapshot(identity, eventId, roundId);
    const cards = await Promise.all(state.round.players.map((player) => this.card(eventId, state.round, player.playerId, state.lock)));
    await this.unchanged(identity, eventId, state.summary.etag, state.memberEtag);
    return this.projection(state.workspace, state.round, cards, state.games);
  }

  private async gameReceipt(eventId: string, roundId: string, requestId: string): Promise<GameChange | undefined> {
    const row = await optionalRow(this.table, eventId, gameChangeKey(roundId, requestId));
    if (!row) return undefined;
    const change = decode(row.content, isGameChange);
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
    const state = await this.snapshot(identity, eventId, roundId);
    if (state.summary.status !== 'active') throw new ApiError(409, 'EVENT_ARCHIVED');
    const replay = await this.replayGames(identity, eventId, roundId, games, expectedEtag, requestId);
    if (replay) return replay;
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
      content: canonical(gameConfigurationContent(eventId, roundId, games)),
    };
    try {
      await this.table.submitTransaction([
        ['update', { partitionKey: eventId, rowKey: 'event', gameRoundIds: canonical(configuredRounds) }, 'Merge', { etag: state.summary.etag }],
        ['update', {
          partitionKey: eventId, rowKey: `member:${identity.objectId}`, ...actor, role: 'owner',
        }, 'Merge', { etag: state.memberEtag }],
        expectedEtag === null ? ['create', entity] : ['update', entity, 'Replace', { etag: expectedEtag }],
        ['create', { partitionKey: eventId, rowKey: gameChangeKey(roundId, requestId), kind: 'game-change', roundId, content: canonical(change) }],
      ]);
    } catch (error) {
      const committed = await this.replayGames(identity, eventId, roundId, games, expectedEtag, requestId);
      if (committed) return committed;
      if (isConflict(error)) throw new ApiError(409, 'GAMES_CHANGED');
      throw error;
    }
    return this.gameAcknowledgement(identity, change);
  }

  private async receipt(eventId: string, requestId: string): Promise<ScoreChange | undefined> {
    const row = await optionalRow(this.table, eventId, `score-change:${requestId}`);
    if (!row) return undefined;
    const change = decode(row.content, isScoreChange);
    if (row.kind !== 'score-change' || row.roundId !== change.roundId || row.playerId !== change.playerId
      || change.eventId !== eventId || change.id !== requestId) throw new ApiError(503, 'INVALID_STORED_SCORE_CHANGE');
    return projectChange(change);
  }

  private async acknowledgement(identity: AccountIdentity, change: ScoreChange): Promise<ScoreWriteResult> {
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

  private async replay(identity: AccountIdentity, eventId: string, roundId: string, playerId: string,
    holeNumber: number, score: HoleScore, expectedEtag: string | null, requestId: string): Promise<ScoreWriteResult | undefined> {
    const change = await this.receipt(eventId, requestId);
    if (!change) return undefined;
    if (change.roundId !== roundId || change.playerId !== playerId || change.holeNumber !== holeNumber
      || change.expectedEtag !== expectedEtag || change.recordedBy.tenantId !== identity.tenantId
      || change.recordedBy.objectId !== identity.objectId || !sameHoleScore(change.after, score)) {
      throw new ApiError(409, 'SCORE_REQUEST_CONFLICT');
    }
    const result = await this.acknowledgement(identity, change);
    if (result.round.eventStatus !== 'active') throw new ApiError(409, 'EVENT_ARCHIVED');
    return result;
  }

  async write(identity: AccountIdentity, eventId: string, roundId: string, playerId: string, holeNumber: number,
    score: HoleScore, expectedEtag: string | null, requestId: string): Promise<ScoreWriteResult> {
    if (!isUuid(requestId) || !isUuid(playerId) || !isHoleScore(score) || !Number.isSafeInteger(holeNumber)
      || expectedEtag !== null && !isEventRevision(expectedEtag)) throw new ApiError(400, 'INVALID_SCORE_WRITE');
    const state = await this.snapshot(identity, eventId, roundId);
    if (state.summary.status !== 'active') throw new ApiError(409, 'EVENT_ARCHIVED');
    if (!state.round.teeProfile.holes.some((hole) => hole.number === holeNumber)) throw new ApiError(400, 'ROUND_HOLE_NOT_FOUND');
    if (!state.round.players.some((player) => player.playerId === playerId)) throw new ApiError(404, 'ROUND_PLAYER_NOT_FOUND');
    const replay = await this.replay(identity, eventId, roundId, playerId, holeNumber, score, expectedEtag, requestId);
    if (replay) return replay;
    const cards = await Promise.all(state.round.players.map((player) => this.card(eventId, state.round, player.playerId, state.lock)));
    const card = cards.find((entry) => entry.playerId === playerId);
    if (!card) throw new ApiError(503, 'INVALID_STORED_SCORECARD');
    if (card.etag !== expectedEtag) throw new ApiError(409, 'SCORECARD_CHANGED');
    const before = card.holes.find((hole) => hole.number === holeNumber);
    if (!before) throw new ApiError(503, 'INVALID_STORED_SCORECARD');
    const recordedAt = new Date().toISOString();
    const actor = { tenantId: identity.tenantId, objectId: identity.objectId };
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
      ['update', {
        partitionKey: eventId, rowKey: `member:${identity.objectId}`, ...actor, role: 'owner',
      }, 'Merge', { etag: state.memberEtag }],
      expectedEtag === null ? ['create', entity] : ['update', entity, 'Replace', { etag: expectedEtag }],
      ['create', {
        partitionKey: eventId, rowKey: `score-change:${requestId}`, kind: 'score-change', roundId, playerId, content: canonical(change),
      }],
    ];
    if (!state.lock) {
      const lock: ScoringLock = {
        kind: 'score-lock', eventId, roundId, requestId, startedAt: recordedAt, startedBy: actor, writtenPlayerIds: [playerId],
      };
      actions.push(['create', { partitionKey: eventId, rowKey: `score-lock:${roundId}`, content: canonical(lock) }]);
    } else if (!state.lock.writtenPlayerIds.includes(playerId)) {
      const lock: ScoringLock = {
        kind: state.lock.kind, eventId, roundId, requestId: state.lock.requestId,
        startedAt: state.lock.startedAt, startedBy: state.lock.startedBy,
        writtenPlayerIds: [...state.lock.writtenPlayerIds, playerId],
      };
      actions.push(['update', {
        partitionKey: eventId, rowKey: `score-lock:${roundId}`, content: canonical(lock),
      }, 'Replace', { etag: state.lock.etag }]);
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

  async history(identity: AccountIdentity, eventId: string, roundId: string, playerId: string, cursor?: string): Promise<ScoreHistoryPage> {
    if (!isUuid(playerId)) throw new ApiError(400, 'INVALID_REQUEST_ID');
    const state = await this.snapshot(identity, eventId, roundId);
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
    await this.unchanged(identity, eventId, state.summary.etag, state.memberEtag);
    return { changes, ...(result.continuationToken ? { continuationToken: result.continuationToken } : {}) };
  }
}
