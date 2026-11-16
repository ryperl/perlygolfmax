import type { TableClient, TransactionAction } from '@azure/data-tables';
import type { PublicScoreIdentity } from '../../../src/domain/public-access.js';
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
import { preserveScoreExtras, sameHoleScore, sameScoreActor, scoreActor } from '../../../src/domain/scoring.js';
import { canonical, decode, isConflict, optionalRow, page, revision } from '../catalog/entities.js';
import { ApiError } from '../errors.js';
import type { TableWorkspaceStore } from '../setup/store.js';
import { scoringLock } from './lock.js';
import { calculateEventSkins, calculateEventSkinsDetails } from '../../../src/domain/event-skins.js';
import type { EventSkinsConfiguration } from '../../../src/domain/event-skins.js';
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
import { sameChurchySpecials } from '../../../src/domain/churchy.js';
import type { KpSelection, KpWriteResult } from '../../../src/domain/kp.js';
import { calculateKp, calculateKpPayout, kpContext, sameKpEntry } from '../../../src/domain/kp.js';
import { isKpSelection } from '../../../src/contracts/kp.js';
import { configuredKpRounds, readKpPot } from './kp.js';

function cardKey(roundId: string, playerId: string): string {
  return `score-card:${roundId}:${playerId}`;
}
function roundKpContext(round: RoundSnapshot): string {
  return kpContext(round.teeProfile.holes, round.players.map((player) => player.playerId),
    kpCaptureIdentity(round));
}
const kpCaptureIdentity = (round: RoundSnapshot) => `${round.id}:${round.courseId}:${round.courseVersionId}:${String(round.teeProfile.id)}`;

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
  constructor(private readonly table: TableClient, private readonly workspace: TableWorkspaceStore,
    private readonly churchyEnabled: () => boolean = () => true) {}

private async kpProjection(eventId: string, roundId: string, configured: unknown) {
  const row = await optionalRow(this.table, eventId, `round-kp:${roundId}`);
  if (Boolean(row) !== configuredKpRounds(configured).includes(roundId)) throw new ApiError(503, 'INVALID_STORED_KP');
  return row ? { kp: { ...decode(await privateContent(this.table, eventId, `round-kp:${roundId}`, row.content), isKpSelection), etag: revision(row) } } : {};
}

async receiveKp(identity: AccountIdentity, eventId: string, roundId: string, body: unknown, expected: string | null, requestId: string) {
  const state = await this.snapshot(identity, eventId, roundId, true);
  if (state.summary.status !== 'active') throw new ApiError(409, 'EVENT_ARCHIVED');
  return receivePrivateWrite(this.table, identity, eventId, `round-kp:${roundId}`, expected, requestId, body);
}

async saveKp(identity: AccountIdentity, eventId: string, roundId: string, selection: KpSelection,
  expectedEtag: string | null, requestId: string): Promise<KpWriteResult> {
  if (!isUuid(requestId) || !isKpSelection(selection)
    || expectedEtag !== null && !isEventRevision(expectedEtag)) throw new ApiError(400, 'INVALID_KP_SETUP');
  const state = await this.snapshot(identity, eventId, roundId, true);
  const grant = this.writer(state);
  if (state.summary.status !== 'active') throw new ApiError(409, 'EVENT_ARCHIVED');
  const receiptKey = `kp-change:${requestId}`;
  const actor = { tenantId: identity.tenantId, objectId: identity.objectId };
  const request = canonical({ roundId, selection, expectedEtag, actor });
  const replay = async () => {
    const receipt = await optionalRow(this.table, eventId, receiptKey);
    if (!receipt) return undefined;
    const stored = decode(await privateContent(this.table, eventId, receiptKey, receipt.content), isRecord);
    if (stored.request !== request) throw new ApiError(409, 'KP_REQUEST_CONFLICT');
    return { round: await this.get(identity, eventId, roundId), requestId, expectedEtag, selection };
  };
  const previous = await replay();
  if (previous) return previous;
  const row = await optionalRow(this.table, eventId, `round-kp:${roundId}`);
  const configuredRounds = configuredKpRounds(state.event.kpRoundIds);
  if (Boolean(row) !== configuredRounds.includes(roundId)) throw new ApiError(503, 'INVALID_STORED_KP');
  const before = row ? decode(await privateContent(this.table, eventId, `round-kp:${roundId}`, row.content), isKpSelection) : null;
  if ((row ? revision(row) : null) !== expectedEtag) throw new ApiError(409, 'KP_CHANGED');
  if (!state.round.teeProfile.holes.some((hole) => hole.par === 3)
    || selection.context !== roundKpContext(state.round)) {
    throw new ApiError(409, 'KP_CONTEXT_CHANGED');
  }
  // Never rebind measurements to a changed saved layout/roster.
  if (before && before.context !== selection.context) throw new ApiError(409, 'KP_CONTEXT_CHANGED');
  const cards = await this.cards(eventId, state.round, state.lock);
  const result = calculateKp({ layout: state.round.teeProfile.holes, cards, kpCaptureIdentity: kpCaptureIdentity(state.round), kp: { ...selection, etag: 'validation' } });
  const pot = await readKpPot(this.table, eventId, roundId, state.event.purseConfigured);
  const payout = pot ? calculateKpPayout({ layout: state.round.teeProfile.holes, cards, kpCaptureIdentity: kpCaptureIdentity(state.round),
    kp: { ...selection, status: 'closed', etag: 'validation' } }, pot.amountMinor) : null;
  if (selection.decisions.some((decision) => {
    const hole = result.holes.find((entry) => entry.number === decision.holeNumber);
    return !hole || hole.closestPlayerIds.length < 2 || hole.proof !== decision.proof
      || decision.holeAmountMinor !== payout?.holes.find((entry) => entry.number === hole.number)?.amountMinor
      || decision.playerIds.some((id) => !hole.closestPlayerIds.includes(id))
      || decision.kind === 'split' && decision.playerIds.length !== hole.closestPlayerIds.length
      || decision.kind === 'winner' && decision.extraCentPlayerIds.length > 0
      || decision.extraCentPlayerIds.some((id) => !decision.playerIds.includes(id))
      || decision.extraCentPlayerIds.length !== decision.holeAmountMinor % decision.playerIds.length;
  })) throw new ApiError(409, 'KP_DECISION_CHANGED');
  const entity = { partitionKey: eventId, rowKey: `round-kp:${roundId}`,
    content: await stagePrivateContent(this.table, eventId, `round-kp:${roundId}`, identity, canonical(selection)) };
  const recordedAt = new Date().toISOString();
  const receiptContent = await stagePrivateContent(this.table, eventId, receiptKey, identity,
    canonical({ request, before, after: selection, recordedAt, recordedBy: actor, requestId }));
  try {
    await this.table.submitTransaction([
      ['update', { partitionKey: eventId, rowKey: 'event', kpUpdatedAt: recordedAt,
        kpRoundIds: canonical(configuredRounds.includes(roundId) ? configuredRounds : [...configuredRounds, roundId]) }, 'Merge', { etag: state.summary.etag }],
      ['update', { partitionKey: eventId, rowKey: `member:${identity.objectId}`, ...actor, role: 'owner' }, 'Merge', { etag: grant.etag }],
      row ? ['update', entity, 'Replace', { etag: revision(row) }] : ['create', entity],
      ['create', { partitionKey: eventId, rowKey: receiptKey, content: receiptContent }],
    ]);
  } catch (error) {
    const committed = await replay();
    if (committed) return committed;
    if (isConflict(error)) throw new ApiError(409, 'KP_CHANGED');
    throw error;
  }
  return { round: await this.get(identity, eventId, roundId), requestId, expectedEtag, selection };
}

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
    if (configuredKpRounds(access.event.kpRoundIds).some((id) => !workspace.rounds.some((entry) => entry.id === id))) throw new ApiError(503, 'INVALID_STORED_KP');
    const lock = await scoringLock(this.table, eventId, roundId);
    if ((round.scoringStarted === true) !== (lock !== undefined)) throw new ApiError(409, 'EVENT_CHANGED');
    const games = await readGameConfiguration(this.table, eventId, roundId, access.gameRoundIds);
    return { ...access, workspace, round, lock, games };
  }

  private async unchanged(identity: ScoreActor, eventId: string, before: EventAccess): Promise<void> {
    await assertEventAccessUnchanged(this.table, identity, eventId, before);
  }

  private writer(state: EventAccess & { readonly round: RoundSnapshot }, playerId?: string, manageGames = false) {
    if (state.publicAccess) {
      if (!playerId && !(manageGames && state.event.quickRound === true)) throw new ApiError(403, 'SCORES_OWNER_REQUIRED');
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
    const kpProjection = await this.kpProjection(workspace.event.id, round.id, access.event.kpRoundIds);
    const kpPot = access.testerLink || !kpProjection.kp ? undefined : await readKpPot(this.table, workspace.event.id, round.id, access.event.purseConfigured);
    return {
      ...(access.event.quickRound === true ? { quickRound: true as const } : {}),
      kpEnabled: true,
      kpCaptureIdentity: kpCaptureIdentity(capturedRound),
      ...(access.testerLink && kpProjection.kp ? { kp: { ...kpProjection.kp, decisions: [] } } : kpProjection),
      ...(kpPot ? { kpPot } : {}),
      churchyEnabled: this.churchyEnabled(),
      teeStrokeAllocation: round.teeProfile.strokeAllocation,
      eventId: workspace.event.id, eventName: workspace.event.name, eventStatus: workspace.event.status,
      roundId: round.id, roundName: round.name, courseName: round.course.name,
      teeName: round.teeProfile.name, teeCategory: round.teeProfile.category, layout: round.teeProfile.holes,
      ...(round.playerTees?.length ? { playerTees: round.playerTees } : {}),
      teeRatings: round.teeProfile.ratings.map((rating) => ({
        type: rating.type, course: rating.course, slope: rating.slope, bogey: rating.bogey,
      })),
      groups: round.groups, cards, setupLocked: round.scoringStarted === true,
      ...(capturedRound.inputRevision ? { inputRevision: capturedRound.inputRevision } : {}),
      ...(capturedRound.reviewWarnings?.length ? { reviewWarnings: capturedRound.reviewWarnings } : {}),
      courseHandicaps: publishedCourseHandicaps(capturedRound),
      permissions: { role: access.publicAccess ? 'public' : access.testerLink ? 'tester' : owner ? 'owner' : viewerPlayerId ? 'player' : 'viewer',
        ...(viewerPlayerId ? { viewerPlayerId } : {}),
        writePlayerIds: !active ? [] : owner || access.testerLink || access.publicAccess ? round.players.map((player) => player.playerId) : ownGroup?.playerIds ?? [],
        canManageGames: active && (owner || access.publicAccess === true && access.event.quickRound === true) },
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

  private async leaderboardSources(identity: ScoreActor, eventId: string, chargeRead: (units: number) => Promise<void>,
    skinsOnly = false): Promise<Pick<EventLeaderboardView, 'workspace' | 'roundScores'>> {
    const access = await this.access(identity, eventId);
    if (access.testerLink) throw new ApiError(403, 'SCORES_OWNER_REQUIRED');
    const workspace = await this.workspace.get(identity, eventId);
    if (workspace.etag !== access.summary.etag) throw new ApiError(409, 'EVENT_CHANGED');
    const roundScores: RoundScores[] = [];
    if (workspace.eventSkins || !skinsOnly && workspace.overallCompetition) {
      if (workspace.rounds.length > 0) await chargeRead(workspace.rounds.length);
      for (let index = 0; index < workspace.rounds.length; index += 3) {
        const batch = await Promise.all(workspace.rounds.slice(index, index + 3).map((round) => this.get(identity, eventId, round.id)));
        roundScores.push(...batch);
      }
    }
    await this.unchanged(identity, eventId, access);
    return { workspace, roundScores };
  }

  async skinsDetails(identity: ScoreActor, eventId: string, chargeRead: (units: number) => Promise<void>) {
    const { workspace, roundScores } = await this.leaderboardSources(identity, eventId, chargeRead, true);
    return calculateEventSkinsDetails(workspace, roundScores);
  }

  async leaderboard(identity: ScoreActor, eventId: string, chargeRead: (units: number) => Promise<void>): Promise<EventLeaderboardView> {
    const { workspace, roundScores } = await this.leaderboardSources(identity, eventId, chargeRead);
    return { workspace, roundScores, standings: calculateEventStandings(workspace, roundScores),
      ...(workspace.eventSkins ? { eventSkins: calculateEventSkins(workspace, roundScores) } : {}) };
  }

  async saveEventSkins(identity: AccountIdentity, eventId: string,
    selection: EventSkinsConfiguration | null, etag: string, requestId: string) {
    return this.workspace.saveEventSkins(identity, eventId, selection, etag, requestId);
  }

  private async gameReceipt(eventId: string, roundId: string, requestId: string): Promise<GameChange | undefined> {
    const row = await optionalRow(this.table, eventId, gameChangeKey(roundId, requestId));
    if (!row) return undefined;
    const change = decode(await privateContent(this.table, eventId, gameChangeKey(roundId, requestId), row.content), isGameChange);
    if (row.kind !== 'game-change' || row.roundId !== roundId || change.eventId !== eventId
      || change.roundId !== roundId || change.id !== requestId) throw new ApiError(503, 'INVALID_STORED_GAMES');
    return change;
  }

  private async gameAcknowledgement(identity: AccountIdentity | PublicScoreIdentity, change: GameChange): Promise<GameWriteResult> {
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

  private async replayGames(identity: AccountIdentity | PublicScoreIdentity, eventId: string, roundId: string,
    games: readonly RoundGameDefinition[], expectedEtag: string | null, requestId: string): Promise<GameWriteResult | undefined> {
    const change = await this.gameReceipt(eventId, roundId, requestId);
    if (!change) return undefined;
    if (change.expectedEtag !== expectedEtag || !sameScoreActor(change.recordedBy, identity)
      || canonical(change.after) !== canonical(games)) {
      throw new ApiError(409, 'GAME_REQUEST_CONFLICT');
    }
    const result = await this.gameAcknowledgement(identity, change);
    if (result.round.eventStatus !== 'active') throw new ApiError(409, 'EVENT_ARCHIVED');
    return result;
  }

  async saveGames(identity: AccountIdentity | PublicScoreIdentity, eventId: string, roundId: string, games: readonly RoundGameDefinition[],
    expectedEtag: string | null, requestId: string): Promise<GameWriteResult> {
    if (!isUuid(requestId) || !isRoundGameDefinitions(games) || games.length === 0
      || expectedEtag !== null && !isEventRevision(expectedEtag)) throw new ApiError(400, 'INVALID_GAME_SETUP');
    if (Buffer.byteLength(JSON.stringify({ games }), 'utf8') > maximumPrivateWriteBytes) {
      throw new ApiError(413, 'REQUEST_TOO_LARGE');
    }
    const state = await this.snapshot(identity, eventId, roundId);
    if (state.summary.role !== 'owner' && !(state.publicAccess && state.event.quickRound === true)) throw new ApiError(403, 'SCORES_OWNER_REQUIRED');
    const grant = this.writer(state, undefined, true);
    if (state.summary.status !== 'active') throw new ApiError(409, 'EVENT_ARCHIVED');
    const savedChurchy = state.games?.games.filter((game) => game.kind === 'churchy') ?? [];
    const nextChurchy = games.filter((game) => game.kind === 'churchy');
    if (!this.churchyEnabled() && !sameGameDefinitions(savedChurchy, nextChurchy)) {
      throw new ApiError(403, 'CHURCHY_DISABLED');
    }
    for (const game of nextChurchy) {
      const previous = savedChurchy.find((entry) => entry.id === game.id);
      if (!previous && state.games?.games.some((saved) => saved.id === game.id)) {
        throw new ApiError(400, 'CHURCHY_REQUIRES_NEW_GAME');
      }
      const group = state.round.groups.find((entry) => entry.number === game.groupNumber);
      if (!group || group.playerIds.length !== 4 || !group.playerIds.every((id) => game.playerIds.includes(id))) {
        if (!previous || !sameGameDefinitions([game], [previous])) throw new ApiError(400, 'INVALID_CHURCHY_GROUP');
      }
      if (state.round.scoringStarted && previous
        && (previous.groupNumber !== game.groupNumber || previous.playerIds.some((id, index) => id !== game.playerIds[index]))) {
        throw new ApiError(409, 'CHURCHY_SETUP_LOCKED');
      }
    }
    if (savedChurchy.some((previous) => !games.some((game) => game.id === previous.id && game.kind === 'churchy'))) {
      throw new ApiError(409, 'CHURCHY_REMOVAL_NOT_SUPPORTED');
    }
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
    const actor: GameChange['recordedBy'] = 'kind' in identity
      ? { kind: 'public-score', eventId: identity.eventId } : { tenantId: identity.tenantId, objectId: identity.objectId };
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
        ...(!('kind' in identity) ? [[
          'update', { partitionKey: eventId, rowKey: `member:${identity.objectId}`, ...actor, role: 'owner' },
          'Merge', { etag: grant.etag },
        ] satisfies TransactionAction] : []),
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

  async receiveGames(identity: AccountIdentity | PublicScoreIdentity,
    eventId: string, roundId: string, body: unknown, expected: string | null, requestId: string) {
    if (!isUuid(roundId) || !isUuid(requestId)) throw new ApiError(400, 'INVALID_REQUEST_ID');
    const state = await this.access(identity, eventId);
    if (state.summary.role !== 'owner' && !(state.publicAccess && state.event.quickRound === true)) throw new ApiError(403, 'SCORES_OWNER_REQUIRED');
    if (state.summary.status !== 'active') throw new ApiError(409, 'EVENT_ARCHIVED');
    if (!await optionalRow(this.table, eventId, `round:${roundId}`)) throw new ApiError(404, 'ROUND_NOT_FOUND');
    // Parts are inactive. Check the head revision without repeatedly decoding a large configuration.
    // The final save validates the complete captured workspace and games again.
    const head = await optionalRow(this.table, eventId, gameConfigurationKey(roundId));
    if ((head ? revision(head) : null) !== expected) {
      const receipt = await this.gameReceipt(eventId, roundId, requestId);
      if (!receipt || receipt.expectedEtag !== expected || !sameScoreActor(receipt.recordedBy, identity)) throw new ApiError(409, 'GAMES_CHANGED');
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
    holeNumber: number, score: HoleScore, expectedEtag: string | null, requestId: string,
    inputRevision?: string | null): Promise<ScoreWriteResult | undefined> {
    const change = await this.receipt(eventId, requestId);
    if (!change) return undefined;
    if (change.roundId !== roundId || change.playerId !== playerId || change.holeNumber !== holeNumber
      || change.expectedEtag !== expectedEtag || !sameScoreActor(change.recordedBy, identity)
      || (change.expectedInputRevision ?? null) !== (inputRevision ?? null)
      || !sameHoleScore(change.after, preserveScoreExtras(score, change.after))) {
      throw new ApiError(409, 'SCORE_REQUEST_CONFLICT');
    }
    const result = await this.acknowledgement(identity, change);
    if (result.round.eventStatus !== 'active') throw new ApiError(409, 'EVENT_ARCHIVED');
    return result;
  }

  async write(identity: ScoreActor, eventId: string, roundId: string, playerId: string, holeNumber: number,
    score: HoleScore, expectedEtag: string | null, requestId: string, inputRevision?: string | null): Promise<ScoreWriteResult> {
    if (!isUuid(requestId) || !isUuid(playerId) || !isHoleScore(score) || !Number.isSafeInteger(holeNumber)
      || expectedEtag !== null && !isEventRevision(expectedEtag)
      || inputRevision !== undefined && inputRevision !== null && !isUuid(inputRevision)) throw new ApiError(400, 'INVALID_SCORE_WRITE');
    const state = await this.snapshot(identity, eventId, roundId);
    if (state.summary.status !== 'active') throw new ApiError(409, 'EVENT_ARCHIVED');
    if (!state.round.teeProfile.holes.some((hole) => hole.number === holeNumber)) throw new ApiError(400, 'ROUND_HOLE_NOT_FOUND');
    if (!state.round.players.some((player) => player.playerId === playerId)) throw new ApiError(404, 'ROUND_PLAYER_NOT_FOUND');
    const grant = this.writer(state, playerId);
    if (state.round.inputRevision && state.round.inputRevision !== inputRevision) throw new ApiError(409, 'SCORE_INPUTS_CHANGED');
    const replay = await this.replay(identity, eventId, roundId, playerId, holeNumber, score, expectedEtag, requestId, inputRevision);
    if (replay) return replay;
    const cards = await this.cards(eventId, state.round, state.lock);
    const card = cards.find((entry) => entry.playerId === playerId);
    if (!card) throw new ApiError(503, 'INVALID_STORED_SCORECARD');
    if (card.etag !== expectedEtag) throw new ApiError(409, 'SCORECARD_CHANGED');
    const before = card.holes.find((hole) => hole.number === holeNumber);
    if (!before) throw new ApiError(503, 'INVALID_STORED_SCORECARD');
    // Legacy/raw-only clients never erase hidden specials.
    const savedScore = preserveScoreExtras(score, before.score);
    if (!sameKpEntry(savedScore.kp, before.score.kp)) {
      const { kp } = await this.kpProjection(eventId, roundId, state.event.kpRoundIds);
      if (!kp || kp.status !== 'open') throw new ApiError(409, 'KP_ENTRIES_CLOSED');
      if (kp.context !== roundKpContext(state.round)
        || !state.round.teeProfile.holes.some((hole) => hole.number === holeNumber && hole.par === 3)) {
        throw new ApiError(409, 'KP_CONTEXT_CHANGED');
      }
    }
    if (!sameChurchySpecials(savedScore.churchy, before.score.churchy)) {
      if (!this.churchyEnabled()) throw new ApiError(403, 'CHURCHY_DISABLED');
      const extras = savedScore.churchy;
      const game = state.games?.games.find((entry) => entry.kind === 'churchy' && entry.id === extras?.gameId);
      if (!extras || game?.kind !== 'churchy' || state.games?.etag !== extras.gameEtag
        || !game.playerIds.includes(playerId)) throw new ApiError(409, 'CHURCHY_SETUP_CHANGED');
      const group = state.round.groups.find((entry) => entry.number === game.groupNumber);
      if (!group || group.playerIds.length !== 4 || !group.playerIds.every((id) => game.playerIds.includes(id))) {
        throw new ApiError(409, 'CHURCHY_SETUP_CHANGED');
      }
    }
    const recordedAt = new Date().toISOString();
    const actor = scoreActor(identity);
    const change: ScoreChange = {
      id: requestId, eventId, roundId, playerId, holeNumber, before: before.score, after: savedScore,
      expectedEtag, ...(state.round.inputRevision ? { expectedInputRevision: state.round.inputRevision } : {}), recordedAt, recordedBy: actor,
    };
    const updated: StoredCard = {
      playerId: card.playerId, displayName: card.displayName, updatedAt: recordedAt,
      holes: card.holes.map((hole) => hole.number === holeNumber ? { number: holeNumber, score: savedScore } : hole),
    };
    const entity = { partitionKey: eventId, rowKey: cardKey(roundId, playerId), content: canonical(updated) };
    const actions: TransactionAction[] = [
      ['update', { partitionKey: eventId, rowKey: 'event', scoresUpdatedAt: recordedAt }, 'Merge', { etag: state.summary.etag }],
      expectedEtag === null ? ['create', entity] : ['update', entity, 'Replace', { etag: expectedEtag }],
      ['create', {
        partitionKey: eventId, rowKey: `score-change:${requestId}`, kind: 'score-change', roundId, playerId, content: canonical(change),
      }],
    ];
    if (!sameKpEntry(savedScore.kp, before.score.kp) && savedScore.kp?.kind === 'measured') {
      // A measurement identity is single-use, even after clearing/restoring its old value.
      // This prevents a caller from resurrecting an earlier tie proof.
      actions.push(['create', { partitionKey: eventId, rowKey: `kp-measurement:${savedScore.kp.measurementId}`,
        roundId, playerId, holeNumber, requestId }]);
    }
    // Public authority is the active event itself, already conditionally updated above.
    // Account and tester writes still check their actual independent grant in this transaction.
    if (!('kind' in identity) || identity.kind === 'tester-link') {
      actions.splice(1, 0, ['update', 'kind' in identity
        ? { partitionKey: eventId, rowKey: testerLinkKey(identity.linkId), scoreRevision: requestId }
        : { partitionKey: eventId, rowKey: `member:${identity.objectId}`, ...actor, role: grant.role },
      'Merge', { etag: grant.etag }]);
    }
    if (!state.lock) {
      const savedRound = await optionalRow(this.table, eventId, `round:${roundId}`);
      if (!savedRound) throw new ApiError(409, 'SCORECARD_CHANGED');
      const captureKey = `index-capture:${roundId}`;
      const capture = {
        kind: 'index-capture', version: 1, eventId, roundId, requestId, recordedAt, recordedBy: actor,
        players: state.round.players.map((entry) => ({ playerId: entry.playerId, handicapIndex: entry.handicapIndex ?? null })),
      };
      const roundContent = await stagePrivateContent(this.table, eventId, `round:${roundId}`, identity, canonical(state.round));
      const captureContent = await stagePrivateContent(this.table, eventId, captureKey, identity, canonical(capture));
      actions.push(
        ['update', { partitionKey: eventId, rowKey: `round:${roundId}`, content: roundContent }, 'Merge', { etag: revision(savedRound) }],
        ['create', { partitionKey: eventId, rowKey: captureKey, content: captureContent }],
      );
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
      const committed = await this.replay(identity, eventId, roundId, playerId, holeNumber, score, expectedEtag, requestId, inputRevision);
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
