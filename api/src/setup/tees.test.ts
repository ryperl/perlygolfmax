import { describe, expect, it } from 'vitest';
import { isEventWorkspace } from '../../../src/contracts/setup.js';
import { isRoundScores } from '../../../src/contracts/scoring.js';
import { stablefordPoints } from '../../../src/domain/stableford.js';
import { teeFixture } from '../../test/tee-fixtures.js';
import { identifier } from '../../test/catalog-fixtures.js';
import { creator, event, member } from '../../test/fixtures.js';
import type { RoundGameDefinition } from '../../../src/domain/games.js';
import { defaultChurchySpecialSelections } from '../../../src/domain/churchy.js';
import { decodeRoundScores } from '../../../src/contracts/scoring.js';
import { leanRoundScores } from '../../../src/contracts/lean-round-scores.js';

describe('organizer per-golfer captured tees', () => {
  it.each(['skins', 'stroke-play', 'ball-drop', 'wolf', 'dots', 'churchy-1', 'churchy-2', 'churchy-3'] as const)(
    'round-trips %s results and lean transport on printed back-nine holes', async (kind) => {
      const f = await teeFixture();
      const input = { ...f.input, rounds: f.input.rounds.map((round) => ({ ...round, roundSide: 'back' as const,
        groups: round.groups.map((group) => ({ ...group, startingHole: 10 })),
      })) };
      await f.workspace.save(creator, event.id, input, f.saved.etag);
      const base = { id: identifier(740), name: 'Fictional nine-hole game', basis: 'net' as const, version: 1 as const };
      const ids = f.input.playerIds;
      const game: RoundGameDefinition = kind === 'skins' ? { ...base, kind, carryovers: true, carryOrder: 'shared-group-v1' }
        : kind === 'stroke-play' ? { ...base, kind }
        : kind === 'ball-drop' ? { ...base, kind, format: 'ball-drop-net-gross', teams: [{ id: identifier(741), name: 'Fictional team', playerIds: ids }] }
        : kind === 'wolf' ? { ...base, kind, version: 2, groupNumber: 1, playerIds: ids, allowPig: true, stakeMinor: null }
        : kind === 'dots' ? { id: base.id, name: base.name, version: 1, kind, groupNumber: 1, playerIds: ids, mode: 'individual', stakeMinor: null, specials: [{ kind: 'birdie', units: 1 }] }
        : kind === 'churchy-3' ? { ...base, name: 'Churchie', kind: 'churchy', version: 3, groupNumber: 1, playerIds: ids,
          orderMode: 'approach', amountPerDotMinor: 0, currency: 'USD', specials: defaultChurchySpecialSelections }
        : { ...base, name: 'Churchy Game', kind: 'churchy', groupNumber: 1,
          playerIds: ids, amountPerDotMinor: 0, currency: 'USD',
          ...(kind === 'churchy-2' ? { version: 2 as const, enabledSpecials: ['birdie'] as const } : { version: 1 as const }) };
      const configured = await f.scores.saveGames(creator, event.id, f.roundId, [game], null, identifier(742));
      expect(isRoundScores(configured.round)).toBe(true);
      let read = configured.round;
      for (const [index, playerId] of ids.entries()) {
        read = (await f.scores.write(creator, event.id, f.roundId, playerId, 10,
          { kind: 'strokes', strokes: 4 }, null, identifier(750 + index))).round;
      }
      expect(isRoundScores(read)).toBe(true);
      expect(decodeRoundScores(leanRoundScores(read, false, false, false, false, false, false, false, false, kind === 'skins'))).toBeDefined();
      expect(read.layout.map((hole) => hole.number)).toEqual([10, 11, 12, 13, 14, 15, 16, 17, 18]);
    },
  );
  it.each(['front', 'back'] as const)('captures %s nine with personal tees, score layouts and first-score setup locks', async (roundSide) => {
    const f = await teeFixture();
    const input = { ...f.input, rounds: f.input.rounds.map((round) => ({ ...round, roundSide,
      groups: round.groups.map((group) => ({ ...group, startingHole: roundSide === 'front' ? 1 : 10 })),
    })) };
    const saved = await f.workspace.save(creator, event.id, input, f.saved.etag);
    expect(isEventWorkspace(saved)).toBe(true);
    expect(saved.rounds[0]).toMatchObject({ roundSide, teeProfile: { id: f.input.rounds[0]?.teeProfileId, holeCount: 9, totalPar: 36 } });
    expect(saved.rounds[0]?.playerTees?.[0]?.profile.holes).toHaveLength(9);
    await f.scores.saveGames(creator, event.id, f.roundId, [{
      id: identifier(731), name: 'Fictional nine-hole Net', basis: 'net', preset: 'standard',
      handicapAllowancePercent: 100, points: stablefordPoints('standard'),
    }], null, identifier(732));
    const start = roundSide === 'front' ? 1 : 10;
    const read = await f.scores.get(creator, event.id, f.roundId);
    expect(isRoundScores(read)).toBe(true);
    expect(read.layout.map((hole) => hole.number)).toEqual(Array.from({ length: 9 }, (_, index) => start + index));
    const written = await f.scores.write(creator, event.id, f.roundId, f.playerId, start,
      { kind: 'strokes', strokes: 4 }, null, identifier(730));
    expect(isRoundScores(written.round)).toBe(true);
    expect(written.round.cards[0]?.holes).toHaveLength(9);
    const current = await f.workspace.get(creator, event.id);
    await expect(f.workspace.save(creator, event.id, { ...input, rounds: input.rounds.map((round) => ({ ...round, roundSide: 'full' })) },
      current.etag)).rejects.toMatchObject({ code: 'ROUND_SCORING_STARTED' });
    const retained = await f.workspace.save(creator, event.id, input, current.etag);
    expect(retained.rounds[0]?.teeProfile).toEqual(saved.rounds[0]?.teeProfile);
  });
  it('rejects nine-hole requests whose starting hole is outside the chosen side', async () => {
    const f = await teeFixture();
    await expect(f.workspace.save(creator, event.id, { ...f.input, rounds: f.input.rounds.map((round) => ({ ...round,
      roundSide: 'back', groups: [{ number: 1, playerIds: f.input.playerIds, startingHole: 1 }],
    })) }, f.saved.etag)).rejects.toMatchObject({ code: 'INVALID_GROUP_STARTING_HOLE' });
  });
  it.each([4, 12])('preserves individual tee inputs for %i golfers while unstarted indexes follow the catalog', async (count) => {
    const f = await teeFixture(count);
    expect(isEventWorkspace(f.saved)).toBe(true);
    expect(f.saved.allowPerGolferTees).toBe(true);
    expect(f.saved.rounds[0]?.playerTees).toEqual([{ playerId: f.playerId, profile: f.alternate }]);
    const read = await f.scores.get(creator, event.id, f.roundId);
    expect(isRoundScores(read)).toBe(true);
    expect(read.playerTees).toEqual(f.saved.rounds[0]?.playerTees);
    f.seed({ partitionKey: event.id, rowKey: `member:${member.objectId}`, ...member, role: 'member' });
    const projection = await f.workspace.get(member, event.id);
    expect(projection.rounds[0]?.playerTees).toEqual(f.saved.rounds[0]?.playerTees);
    expect(projection.rounds[0]?.players.every((player) => player.handicapIndex === undefined)).toBe(true);
    const player = await f.players.get(creator, f.playerId);
    await f.players.observe(creator, player.id, identifier(700), {
      value: '18.0', effectiveDate: '2026-02-01', source: 'Fictional later observation',
    }, player.etag);
    expect((await f.workspace.get(creator, event.id)).rounds[0]?.players[0]?.handicapIndex?.value).toBe('18.0');
    expect((await f.workspace.get(creator, event.id)).rounds[0]?.playerTees).toEqual(read.playerTees);
  });
  it('uses the captured player rating/par/index in authoritative game results and rejects a common-tee point substitution', async () => {
    const f = await teeFixture();
    await f.scores.saveGames(creator, event.id, f.roundId, [{
      id: identifier(710), name: 'Fictional Net', basis: 'net', preset: 'standard',
      handicapAllowancePercent: 100, points: stablefordPoints('standard'),
    }], null, identifier(711));
    const result = await f.scores.write(creator, event.id, f.roundId, f.playerId, 1,
      { kind: 'strokes', strokes: 4 }, null, identifier(712));
    expect(isRoundScores(result.round)).toBe(true);
    expect(result.round.games?.results[0]?.players[0]).toMatchObject({ playingHandicap: 2, totalPoints: 3 });
    const games = result.round.games;
    if (!games) throw new Error('Missing fictional game result.');
    const tampered = { ...result.round, playerTees: undefined };
    expect(isRoundScores({ ...tampered, games })).toBe(false);
    expect(result.round.cards[0]?.holes[0]?.score).toEqual({ kind: 'strokes', strokes: 4 });
  });
  it('preserves legacy omissions and locks captured assignments and the event option after scoring', async () => {
    const f = await teeFixture();
    const { allowPerGolferTees: ignored, ...legacy } = f.input;
    void ignored;
    const oldInput = { ...legacy, rounds: legacy.rounds.map(({ playerTeeSelections: omitted, ...round }) => {
      void omitted;
      return round;
    }) };
    const renamed = await f.workspace.save(creator, event.id, { ...oldInput, name: 'Fictional renamed' }, f.saved.etag);
    expect(renamed.allowPerGolferTees).toBe(true);
    expect(renamed.rounds[0]?.playerTees).toEqual(f.saved.rounds[0]?.playerTees);
    await f.scores.write(creator, event.id, f.roundId, f.playerId, 1, { kind: 'strokes', strokes: 4 }, null, identifier(720));
    const current = await f.workspace.get(creator, event.id);
    await expect(f.workspace.save(creator, event.id, {
      ...oldInput, allowPerGolferTees: false,
    }, current.etag)).rejects.toMatchObject({ status: 409, code: 'PER_GOLFER_TEES_LOCKED' });
    await expect(f.workspace.save(creator, event.id, {
      ...f.input, rounds: f.input.rounds.map((round) => ({ ...round, playerTeeSelections: [] })),
    }, current.etag)).rejects.toMatchObject({ status: 409, code: 'ROUND_SCORING_STARTED' });
    const retained = await f.workspace.save(creator, event.id, oldInput, current.etag);
    expect(retained.rounds[0]?.playerTees).toEqual(f.saved.rounds[0]?.playerTees);
  });
  it('rejects incompatible/unknown/foreign assignments and allows explicit unscored disable', async () => {
    const f = await teeFixture();
    for (const selection of [
      { playerId: f.playerId, teeProfileId: f.nine.id },
      { playerId: f.playerId, teeProfileId: 9999 },
      { playerId: identifier(999), teeProfileId: f.alternate.id },
    ]) await expect(f.workspace.save(creator, event.id, {
      ...f.input, rounds: f.input.rounds.map((round) => ({ ...round, playerTeeSelections: [selection] })),
    }, f.saved.etag)).rejects.toMatchObject({ status: 400 });
    expect(f.submit).not.toHaveBeenCalled();
    const off = await f.workspace.save(creator, event.id, {
      ...f.input, allowPerGolferTees: false,
      rounds: f.input.rounds.map((round) => ({ ...round, playerTeeSelections: [] })),
    }, f.saved.etag);
    expect(off.allowPerGolferTees).toBe(false);
    expect(off.rounds[0]?.playerTees).toBeUndefined();
  });
  it('does not preserve an unscored override for a golfer intentionally removed by a legacy roster edit', async () => {
    const f = await teeFixture();
    const newPlayer = await f.players.create(creator, identifier(900), 'Fictional New Golfer');
    const ids = [...f.input.playerIds.filter((id) => id !== f.playerId), newPlayer.id];
    const changed = await f.workspace.save(creator, event.id, {
      ...f.input, playerIds: ids, rounds: f.input.rounds.map(({ playerTeeSelections: omitted, ...round }) => {
        void omitted;
        return { ...round, groups: [{ number: 1, playerIds: ids }] };
      }),
    }, f.saved.etag);
    expect(isEventWorkspace(changed)).toBe(true);
    expect(changed.rounds[0]?.playerTees).toBeUndefined();
  });
});
