import { describe, expect, it } from 'vitest';
import { calculateDots } from '../domain/dots.js';
import type { DotsGameDefinition, DotsHoleRecord } from '../domain/dots.js';
import type { DotRoundInput } from '../domain/dot-context.js';
import { dotsDefinitionMatchesRound, dotsRecordsMatchGame, isDotsDefinition, isDotsHoleRecord, isDotsResults } from './dots.js';

const A = '00000000-0000-4000-8000-000000000001';
const B = '00000000-0000-4000-8000-000000000002';
const C = '00000000-0000-4000-8000-000000000003';
const D = '00000000-0000-4000-8000-000000000004';
const gameId = '00000000-0000-4000-8000-000000000005';
const linkedGameId = '00000000-0000-4000-8000-000000000006';
const callId = '00000000-0000-4000-8000-000000000007';
const otherId = '00000000-0000-4000-8000-000000000008';
const game: DotsGameDefinition = { id: gameId, name: 'Dots A', kind: 'dots', version: 1, mode: 'individual',
  groupNumber: 1, playerIds: [A, B, C, D], stakeMinor: null,
  specials: [{ kind: 'sandy', units: 1 }, { kind: 'paree', units: 1 }, { kind: 'kp', units: 1 }] };
const round: DotRoundInput = { layout: [{ number: 1, par: 3, allocation: 1, length: 150, sourceId: 1 }],
  groups: [{ number: 1, playerIds: game.playerIds }],
  cards: game.playerIds.map((playerId, index) => ({ playerId, displayName: ['A', 'B', 'C', 'D'][index] ?? '', etag: null, updatedAt: null,
    holes: [{ number: 1, score: { kind: 'strokes', strokes: 3 } }] })) };
const record: DotsHoleRecord = { number: 1, gameId: game.id, gameEtag: 'revision-A',
  players: [{ playerId: A, counts: { sandy: 3 }, calls: [{ id: callId, kind: 'paree', result: 'success' }] }],
  contests: [{ kind: 'kp', status: 'awarded', winnerId: A, secondId: B }] };

describe('Dots network contracts', () => {
  it('accepts explicit standalone and linked modes without granting the linked game its own stake', () => {
    expect(isDotsDefinition(game)).toBe(true);
    expect(isDotsDefinition({ ...game, stakeMinor: 0 })).toBe(true);
    expect(isDotsDefinition({ ...game, mode: 'fixed', partnerIds: [D, A, B, C] })).toBe(true);
    const { stakeMinor: omitted, ...base } = game;
    expect(omitted).toBeNull();
    expect(isDotsDefinition({ ...base, mode: 'linked', linkedGameId })).toBe(true);
    expect(isDotsDefinition({ ...game, mode: 'linked', linkedGameId })).toBe(false);
    expect(isDotsDefinition({ ...base, mode: 'linked', linkedGameId: game.id })).toBe(false);
  });

  it.each([
    { specials: [{ kind: 'thief', units: 1 }] },
    { specials: [{ kind: 'sandy', units: 0 }] },
    { specials: [{ kind: 'sandy', units: -1 }] },
    { specials: [{ kind: 'sandy', units: Number.MAX_SAFE_INTEGER + 1 }] },
    { specials: [{ kind: 'sandy', units: 1 }, { kind: 'sandy', units: 2 }] },
    { playerIds: [A, A, C, D] },
    { mode: 'fixed', partnerIds: [A, B, C, otherId] },
    { stakeMinor: 0.1 },
    { stakeMinor: undefined },
    { preset: 'standard' },
    { teams: [] },
    { basis: 'net' },
  ])('rejects malformed configuration %j', (patch) => {
    expect(isDotsDefinition({ ...game, ...patch })).toBe(false);
  });

  it('rejects unsupported individual Assassin and standalone Sweep while accepting their compatible modes', () => {
    const assassin = { ...game, specials: [{ kind: 'assassin', units: 1 }] };
    expect(isDotsDefinition(assassin)).toBe(false);
    expect(isDotsDefinition({ ...assassin, mode: 'fixed', partnerIds: game.playerIds })).toBe(true);
    const sweep = { ...game, specials: [{ kind: 'sweep', units: 1 }] };
    expect(isDotsDefinition(sweep)).toBe(false);
    expect(isDotsDefinition({ ...sweep, mode: 'fixed', partnerIds: game.playerIds })).toBe(false);
    const { stakeMinor: omitted, ...base } = sweep;
    expect(omitted).toBeNull();
    expect(isDotsDefinition({ ...base, mode: 'linked', linkedGameId })).toBe(true);
  });

  it.each([
    { id: 'not-a-uuid' },
    { playerIds: ['A', B, C, D] },
    { mode: 'fixed', partnerIds: [A, B, C, 'D'] },
  ])('rejects non-UUID definition references with otherwise valid fields: %j', (patch) => {
    expect(isDotsDefinition({ ...game, ...patch })).toBe(false);
  });

  it('requires a UUID linked game reference independently of optional stake exclusion', () => {
    const { stakeMinor: omitted, ...base } = game;
    expect(omitted).toBeNull();
    expect(isDotsDefinition({ ...base, mode: 'linked', linkedGameId })).toBe(true);
    expect(isDotsDefinition({ ...base, mode: 'linked', linkedGameId: 'base-A' })).toBe(false);
  });

  it.each([
    { gameId: 'dots-A' },
    { players: [{ playerId: 'A', counts: {}, calls: [] }] },
    { players: [{ playerId: A, counts: {}, calls: [{ id: 'call-A', kind: 'paree', result: 'success' }] }] },
    { contests: [{ kind: 'kp', status: 'awarded', winnerId: 'A' }] },
    { contests: [{ kind: 'kp', status: 'awarded', winnerId: A, secondId: 'B' }] },
  ])('rejects non-UUID record references with otherwise valid fields: %j', (patch) => {
    expect(isDotsHoleRecord({ ...record, ...patch })).toBe(false);
  });

  it.each(['*', '', 'revision with spaces', 'revision\nA', 'x'.repeat(513)])(
    'rejects invalid event revision %j', (gameEtag) => {
      expect(isDotsHoleRecord({ ...record, gameEtag })).toBe(false);
    },
  );

  it('shares the full existing printable event revision range instead of imposing a new text limit', () => {
    expect(isDotsHoleRecord({ ...record, gameEtag: 'x'.repeat(512) })).toBe(true);
  });

  it('accepts full empty snapshots as explicit clearing and call corrections as new truth', () => {
    expect(isDotsHoleRecord(record)).toBe(true);
    expect(isDotsHoleRecord({ ...record, players: [], contests: [] })).toBe(true);
    const corrected: DotsHoleRecord = { ...record, players: record.players.map((player) => ({ ...player,
      calls: [{ id: callId, kind: 'paree', result: 'failure' as const }] })) };
    expect(isDotsHoleRecord(corrected)).toBe(true);
    expect(dotsRecordsMatchGame([corrected], game, round)).toBe(true);
    expect(calculateDots(game, round, [corrected]).awards.find((award) => award.kind === 'paree')?.recipientIds).toEqual([B, C, D]);
  });

  it.each(['birdie', 'eagle', 'string', 'birdy-string', 'king-of-the-hill', 'assassin', 'sweep', 'kp', 'blue-plate', 'long-drive', 'paree', 'murphy', 'pully-murphy', 'thief'])(
    'rejects automatic/contest/call kind %s in ordinary manual counts', (kind) => {
      expect(isDotsHoleRecord({ ...record, players: [{ playerId: A, counts: { [kind]: 1 }, calls: [] }] })).toBe(false);
    },
  );

  it.each([
    { counts: { sandy: 1.5 }, calls: [] },
    { counts: { sandy: -1 }, calls: [] },
    { counts: { sandy: Number.MAX_SAFE_INTEGER + 1 }, calls: [] },
    { counts: { dime: 1, 'super-dime': 1 }, calls: [] },
    { counts: {}, calls: [{ id: callId, kind: 'paree', result: 'success' }, { id: callId, kind: 'paree', result: 'failure' }] },
    { counts: {}, calls: [{ id: callId, kind: 'sandy', result: 'success' }] },
  ])('rejects invalid counts/calls %j', (declaration) => {
    expect(isDotsHoleRecord({ ...record, players: [{ playerId: A, ...declaration }] })).toBe(false);
  });

  it.each([
    [{ kind: 'kp', status: 'skip' }],
    [{ kind: 'kp', status: 'awarded' }],
    [{ kind: 'kp', status: 'awarded', winnerId: A, secondId: A }],
    [{ kind: 'long-drive', status: 'awarded', winnerId: A, secondId: B }],
    [{ kind: 'kp', status: 'no-qualifier', winnerId: A }],
    [{ kind: 'kp', status: 'no-qualifier' }, { kind: 'kp', status: 'awarded', winnerId: A }],
  ])('rejects ambiguous/unsupported contest snapshots %j', (...contests) => {
    expect(isDotsHoleRecord({ ...record, contests })).toBe(false);
  });

  it('requires exact game, group, player, layout and enabled-special references for writes', () => {
    expect(dotsDefinitionMatchesRound(game, round)).toBe(true);
    expect(dotsRecordsMatchGame([record], game, round)).toBe(true);
    expect(dotsRecordsMatchGame([record, record], game, round)).toBe(false);
    expect(dotsRecordsMatchGame([{ ...record, gameId: otherId }], game, round)).toBe(false);
    expect(dotsRecordsMatchGame([{ ...record, number: 2 }], game, round)).toBe(false);
    expect(dotsRecordsMatchGame([{ ...record, players: [{ playerId: otherId, counts: {}, calls: [] }] }], game, round)).toBe(false);
    expect(dotsRecordsMatchGame([record], { ...game, specials: [] }, round)).toBe(false);
    expect(dotsRecordsMatchGame([{ ...record, contests: [{ kind: 'long-drive', status: 'awarded', winnerId: A }] }], game, round)).toBe(false);
    expect(dotsDefinitionMatchesRound(game, { ...round, groups: [{ number: 1, playerIds: [A, B, C] }] })).toBe(false);
    expect(dotsDefinitionMatchesRound(game, { ...round, groups: [{ number: 1, playerIds: game.playerIds, startingHole: 2 }] })).toBe(false);
  });

  it('validates successful calls against the AFTER matrix, but does not infer failures from missing scores', () => {
    const worse: DotRoundInput = { ...round, cards: round.cards.map((card) => ({ ...card,
      holes: [{ number: 1, score: { kind: 'strokes', strokes: 5 } }] })) };
    expect(dotsRecordsMatchGame([record], game, worse)).toBe(false);
    const pending: DotsHoleRecord = { ...record, players: [{ playerId: A, counts: {},
      calls: [{ id: callId, kind: 'paree', result: 'pending' }] }] };
    expect(dotsRecordsMatchGame([pending], game, worse)).toBe(true);
    const missing: DotRoundInput = { ...round, cards: round.cards.map((card) => ({ ...card,
      holes: [{ number: 1, score: { kind: 'unplayed' } }] })) };
    const callOnly = { ...record, players: record.players.map((player) => ({ ...player, counts: {} })) };
    expect(dotsRecordsMatchGame([callOnly], game, missing)).toBe(true);
    expect(calculateDots(game, missing, [callOnly]).awards.some((award) => award.kind === 'paree')).toBe(false);
  });

  it('recomputes every projection field and retains historical invalid-group projections for repair', () => {
    const result = calculateDots(game, round, [record]);
    expect(isDotsResults(result, game, round, [record])).toBe(true);
    expect(isDotsResults({ ...result, awards: [] }, game, round, [record])).toBe(false);
    expect(isDotsResults({ ...result, unexpectedPrivateMetadata: true }, game, round, [record])).toBe(false);
    expect(isDotsResults({ ...result, players: result.players.map((player) => ({ ...player, totalPoints: 999 })) }, game, round, [record])).toBe(false);
    const changed = { ...round, groups: [] };
    const invalid = calculateDots(game, changed, [record]);
    expect(invalid.status).toBe('unavailable');
    expect(isDotsResults(invalid, game, changed, [record])).toBe(true);
  });
});
