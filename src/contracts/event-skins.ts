import type { EventSkinsChange, EventSkinsConfiguration, EventSkinsResults } from '../domain/event-skins.js';
import { calculateEventSkins } from '../domain/event-skins.js';
import type { EventWorkspace } from '../domain/setup.js';
import type { RoundScores } from '../domain/scoring.js';
import { isEventRevision, isRecord, isUuid } from './events.js';
import { isDateOnly } from './catalog.js';
import { roundScoresMatchWorkspace, sameJsonValue } from './round-context.js';
import { publishedCourseHandicaps } from '../domain/playing-handicaps.js';

export function isEventSkinsConfiguration(value: unknown): value is EventSkinsConfiguration {
  return isRecord(value) && Object.keys(value).length === 1 && value.version === 1;
}

export function isEventSkinsChange(value: unknown): value is EventSkinsChange {
  return isRecord(value) && Object.keys(value).length === 7
    && Object.keys(value).every((key) => ['id', 'eventId', 'expectedEtag', 'before', 'after', 'recordedAt', 'recordedBy'].includes(key))
    && isUuid(value.id) && isUuid(value.eventId) && isEventRevision(value.expectedEtag)
    && (value.before === null || isEventSkinsConfiguration(value.before))
    && (value.after === null || isEventSkinsConfiguration(value.after))
    && typeof value.recordedAt === 'string' && value.recordedAt.length <= 40
    && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(value.recordedAt)
    && isDateOnly(value.recordedAt.slice(0, 10)) && Number.isFinite(Date.parse(value.recordedAt))
    && isRecord(value.recordedBy) && Object.keys(value.recordedBy).length === 2
    && isUuid(value.recordedBy.tenantId) && isUuid(value.recordedBy.objectId);
}

export function isEventSkinsResults(value: unknown, workspace: EventWorkspace,
  rounds: readonly RoundScores[]): value is EventSkinsResults {
  return (workspace.eventSkins ? roundScoresMatchWorkspace(workspace, rounds) && workspace.rounds.every((snapshot) => {
    const source = rounds.find((round) => round.roundId === snapshot.id);
    return source !== undefined && source.setupLocked === (snapshot.scoringStarted === true)
      && (source.setupLocked || source.cards.every((card) => card.holes.every((hole) => hole.score.kind === 'unplayed')))
      && (source.courseHandicaps === undefined
        || snapshot.players.some((player) => player.handicapIndex === undefined && player.handicapIndexValue === undefined)
        || sameJsonValue(source.courseHandicaps, publishedCourseHandicaps(snapshot)));
  }) : rounds.length === 0)
    && sameJsonValue(value, calculateEventSkins(workspace, rounds));
}
