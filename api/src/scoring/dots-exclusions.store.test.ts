import { describe, expect, it } from 'vitest';
import type { DotsGameDefinition, DotsHoleRecord, DotsPlayerDeclaration } from '../../../src/domain/dots.js';
import type { RoundScores } from '../../../src/domain/scoring.js';
import { isRoundScores } from '../../../src/contracts/scoring.js';
import { publicFixture } from '../public-access/test-support.js';
import { event } from '../../test/fixtures.js';
import { identifier } from '../../test/catalog-fixtures.js';

function cardEtag(round: RoundScores, playerId: string): string | null {
  const card = round.cards.find((entry) => entry.playerId === playerId);
  if (!card) throw new Error('Missing fictional card');
  return card.etag;
}

async function fixture(version: 1 | 2) {
  const f = await publicFixture();
  const common = { id: identifier(22600), name: 'Fictional specials', kind: 'dots' as const,
    groupNumber: 1, playerIds: f.input.playerIds.slice(0, 4), stakeMinor: null,
    specials: [{ kind: 'hogan' as const, units: 1 }, { kind: 'seve' as const, units: 1 },
      { kind: 'pully' as const, units: 1 }, { kind: 'dime' as const, units: 1 },
      { kind: 'super-dime' as const, units: 1 }, { kind: 'murphy' as const, units: 1 },
      { kind: 'chippy' as const, units: 1 }, { kind: 'walk' as const, units: 1 },
      { kind: 'sandy' as const, units: 1 }] };
  const game: DotsGameDefinition = version === 1 ? { ...common, version: 1, mode: 'individual' }
    : { ...common, version: 2, mode: 'rotating', rotationHoles: 3 };
  const round = (await f.scores.saveGames(f.actor, event.id, f.roundId, [game], null, identifier(22601))).round;
  const record = (players: readonly DotsPlayerDeclaration[]): DotsHoleRecord => ({
    number: 1, gameId: game.id, gameEtag: round.games?.configuration.etag ?? 'missing', players, contests: [],
    ...(version === 2 ? { rotation: { playerIds: game.playerIds } } : {}),
  });
  return { ...f, game, round, record };
}

describe('new Dots declaration exclusions with legacy preservation', () => {
  it.each([1, 2] as const)('rejects Churcie-only press stages from ordinary Dots v%i writes and marks malformed saved records unavailable', async (version) => {
    const f = await fixture(version);
    for (const murphyPresses of [0, 1, 2] as const) {
      const record = f.record([{ playerId: f.playerId, counts: {}, calls: [{
        id: identifier(22800), kind: 'murphy', result: 'pending', murphyPresses,
      }] }]);
      await expect(f.scores.write(f.actor, event.id, f.roundId, f.playerId, 1,
        { kind: 'strokes', strokes: 4, dots: [record] }, null, identifier(22801 + murphyPresses)))
        .rejects.toMatchObject({ code: 'DOTS_SETUP_CHANGED' });
    }
    const record = f.record([{ playerId: f.playerId, counts: {}, calls: [{
      id: identifier(22805), kind: 'murphy', result: 'pending',
    }] }]);
    const saved = await f.scores.write(f.actor, event.id, f.roundId, f.playerId, 1,
      { kind: 'strokes', strokes: 4, dots: [record] }, null, identifier(22806));
    const card = saved.round.cards.find((entry) => entry.playerId === f.playerId);
    if (!card) throw new Error('Missing fictional card');
    const malformed = { ...record, players: record.players.map((player) => ({ ...player,
      calls: player.calls.map((call) => ({ ...call, murphyPresses: 2 as const })) })) };
    f.seed({ ...f.row(`score-card:${f.roundId}:${f.playerId}`), content: JSON.stringify({
      playerId: card.playerId, displayName: card.displayName, updatedAt: card.updatedAt,
      holes: card.holes.map((hole) => hole.number === 1 ? { ...hole,
        score: { kind: 'strokes', strokes: 4, dots: [malformed] } } : hole),
    }) });
    const read = await f.scores.get(f.actor, event.id, f.roundId);
    expect(read.games?.results[0]?.dots?.status).toBe('unavailable');
    expect(read.games?.results[0]?.dots?.awards).toEqual([]);
    expect(isRoundScores(read)).toBe(true);
  });

  it.each([1, 2] as const)('rejects new same-golfer conflicts for version %i but permits teammates and warning-only Walk', async (version) => {
    const f = await fixture(version);
    const conflicts: readonly DotsPlayerDeclaration[] = [
      { playerId: f.playerId, counts: { hogan: 1, seve: 1 }, calls: [] },
      { playerId: f.playerId, counts: { pully: 1, dime: 1 }, calls: [] },
      { playerId: f.playerId, counts: { pully: 1, 'super-dime': 1 }, calls: [] },
      { playerId: f.playerId, counts: { hogan: 1, chippy: 1 }, calls: [] },
      { playerId: f.playerId, counts: { hogan: 1 },
        calls: [{ id: identifier(22602), kind: 'murphy', result: 'pending' }] },
    ];
    for (const player of conflicts) {
      await expect(f.scores.write(f.actor, event.id, f.roundId, f.playerId, 1,
        { kind: 'strokes', strokes: 4, dots: [f.record([player])] }, null, identifier(22603)))
        .rejects.toMatchObject({ status: 409, code: 'DOTS_SETUP_CHANGED' });
    }
    const differentPlayers = [{ playerId: f.playerId, counts: { hogan: 1, walk: 1 }, calls: [] },
      { playerId: f.game.playerIds[1] ?? '', counts: { seve: 1, walk: 1 }, calls: [] }];
    const saved = await f.scores.write(f.actor, event.id, f.roundId, f.playerId, 1,
      { kind: 'strokes', strokes: 4, dots: [f.record(differentPlayers)] }, null, identifier(22604));
    expect(saved.change.after.dots?.[0]?.players).toEqual(differentPlayers);
    expect(isRoundScores(saved.round)).toBe(true);
  });

  it('retains unchanged conflicting legacy v1 extras on raw-only and other-golfer edits, but requires a changed declaration to be repaired', async () => {
    const f = await fixture(1);
    const initial = f.record([{ playerId: f.playerId, counts: { hogan: 1 }, calls: [] }]);
    const saved = await f.scores.write(f.actor, event.id, f.roundId, f.playerId, 1,
      { kind: 'strokes', strokes: 4, dots: [initial] }, null, identifier(22700));
    const card = saved.round.cards.find((entry) => entry.playerId === f.playerId);
    if (!card) throw new Error('Missing fictional card');
    const legacy = f.record([{ playerId: f.playerId, counts: { hogan: 1, seve: 1 }, calls: [] }]);
    const stored = { playerId: card.playerId, displayName: card.displayName, updatedAt: card.updatedAt,
      holes: card.holes.map((hole) => hole.number === 1 ? { ...hole, score: { kind: 'strokes', strokes: 4, dots: [legacy] } } : hole) };
    f.seed({ ...f.row(`score-card:${f.roundId}:${f.playerId}`), content: JSON.stringify(stored) });
    const historic = await f.scores.get(f.actor, event.id, f.roundId);
    expect(isRoundScores(historic)).toBe(true);
    const raw = await f.scores.write(f.actor, event.id, f.roundId, f.playerId, 1,
      { kind: 'strokes', strokes: 4 }, cardEtag(historic, f.playerId), identifier(22701));
    expect(raw.change.after.dots).toEqual([legacy]);
    const peer = { playerId: f.game.playerIds[1] ?? '', counts: { sandy: 1 }, calls: [] };
    const edited = await f.scores.write(f.actor, event.id, f.roundId, f.playerId, 1,
      { kind: 'strokes', strokes: 4, dots: [{ ...legacy, players: [...legacy.players, peer] }] },
      cardEtag(raw.round, f.playerId), identifier(22702));
    expect(edited.change.after.dots?.[0]?.players).toEqual([...legacy.players, peer]);
    await expect(f.scores.write(f.actor, event.id, f.roundId, f.playerId, 1,
      { kind: 'strokes', strokes: 4, dots: [{ ...legacy, players: [{
        playerId: f.playerId, counts: { hogan: 1, seve: 1, sandy: 1 }, calls: [],
      }, peer] }] }, cardEtag(edited.round, f.playerId), identifier(22703)))
      .rejects.toMatchObject({ code: 'DOTS_SETUP_CHANGED' });
    const repaired = await f.scores.write(f.actor, event.id, f.roundId, f.playerId, 1,
      { kind: 'strokes', strokes: 4, dots: [{ ...legacy, players: [initial.players[0] ?? peer, peer] }] },
      cardEtag(edited.round, f.playerId), identifier(22704));
    expect(isRoundScores(repaired.round)).toBe(true);
  });
});
