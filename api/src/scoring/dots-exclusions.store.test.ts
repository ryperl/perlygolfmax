import { describe, expect, it } from 'vitest';
import type { DotsGameDefinition, DotsHoleRecord, DotsPlayerDeclaration } from '../../../src/domain/dots.js';
import type { RoundScores } from '../../../src/domain/scoring.js';
import { isRoundScores } from '../../../src/contracts/scoring.js';
import { publicFixture } from '../public-access/test-support.js';
import { creator, event } from '../../test/fixtures.js';
import { identifier } from '../../test/catalog-fixtures.js';

function cardEtag(round: RoundScores, playerId: string): string | null {
  const card = round.cards.find((entry) => entry.playerId === playerId);
  if (!card) throw new Error('Missing fictional card');
  return card.etag;
}

async function fixture(version: 1 | 2, automatic = false) {
  const f = await publicFixture();
  const common = { id: identifier(22600), name: 'Fictional specials', kind: 'dots' as const,
    groupNumber: 1, playerIds: f.input.playerIds.slice(0, 4), stakeMinor: null,
    specials: [{ kind: 'hogan' as const, units: 1 }, { kind: 'seve' as const, units: 1 },
      { kind: 'pully' as const, units: 1 }, { kind: 'dime' as const, units: 1 },
      { kind: 'super-dime' as const, units: 1 }, { kind: 'murphy' as const, units: 1 },
      { kind: 'chippy' as const, units: 1 }, { kind: 'walk' as const, units: 1 },
      { kind: 'paree' as const, units: 1 }, { kind: 'pully-murphy' as const, units: 1 },
      { kind: 'haz-par' as const, units: 1 },
      { kind: 'kp' as const, units: 1 },
      { kind: 'sandy' as const, units: 1 },
      ...(automatic ? [{ kind: 'birdie' as const, units: 2 }, { kind: 'eagle' as const, units: 4 },
        { kind: 'string' as const, units: 1 }, { kind: 'birdy-string' as const, units: 1 }] : [])] };
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
  it.each([1, 2] as const)('checks a v%i peer raw save against its source declaration on the canonical anchor card', async (version) => {
    const f = await fixture(version, true);
    const peer = f.game.playerIds[1];
    if (!peer) throw new Error('Missing fictional peer');
    const record = f.record([{ playerId: peer, counts: {}, calls: [{
      id: identifier(22970), kind: 'paree', result: 'failure',
    }] }]);
    const saved = await f.scores.write(f.actor, event.id, f.roundId, f.playerId, 1,
      { kind: 'strokes', strokes: 3, dots: [record] }, null, identifier(22971));
    const rows = new Map(f.rows);
    f.submit.mockClear();
    await expect(f.scores.write(f.actor, event.id, f.roundId, peer, 1,
      { kind: 'strokes', strokes: 3 }, cardEtag(saved.round, peer), identifier(22972)))
      .rejects.toMatchObject({ code: 'DOTS_SETUP_CHANGED' });
    expect(f.submit).not.toHaveBeenCalled();
    expect(f.rows).toEqual(rows);
  });

  it('rejects a rotation-only receipt that would activate a historical failed-call automatic conflict', async () => {
    const f = await fixture(2, true);
    const first = await f.scores.write(f.actor, event.id, f.roundId, f.playerId, 1,
      { kind: 'strokes', strokes: 3 }, null, identifier(22980));
    const card = first.round.cards.find((entry) => entry.playerId === f.playerId);
    if (!card) throw new Error('Missing fictional card');
    const { rotation, ...legacy } = f.record([{ playerId: f.playerId, counts: {}, calls: [{
      id: identifier(22981), kind: 'paree', result: 'failure',
    }] }]);
    if (!rotation) throw new Error('Missing fictional rotation');
    f.seed({ ...f.row(`score-card:${f.roundId}:${f.playerId}`), content: JSON.stringify({
      playerId: card.playerId, displayName: card.displayName, updatedAt: card.updatedAt,
      holes: card.holes.map((hole) => hole.number === 1 ? { ...hole, score: { kind: 'strokes', strokes: 3, dots: [legacy] } } : hole),
    }) });
    const historical = await f.scores.get(f.actor, event.id, f.roundId);
    expect(isRoundScores(historical)).toBe(true);
    const raw = await f.scores.write(f.actor, event.id, f.roundId, f.playerId, 1,
      { kind: 'strokes', strokes: 3 }, cardEtag(historical, f.playerId), identifier(22982));
    expect(raw.change.after.dots).toEqual([legacy]);
    const rows = new Map(f.rows);
    f.submit.mockClear();
    await expect(f.scores.write(f.actor, event.id, f.roundId, f.playerId, 1,
      { kind: 'strokes', strokes: 3, dots: [{ ...legacy, rotation }] }, cardEtag(raw.round, f.playerId), identifier(22983)))
      .rejects.toMatchObject({ code: 'DOTS_SETUP_CHANGED' });
    expect(f.submit).not.toHaveBeenCalled();
    expect(f.rows).toEqual(rows);
  });

  it.each([1, 2] as const)('preserves historical automatic conflicts on v%i raw/peer edits but rejects a newly earned replacement', async (version) => {
    const f = await fixture(version, true);
    const initial = f.record([{ playerId: f.playerId, counts: {}, calls: [] }]);
    const first = await f.scores.write(f.actor, event.id, f.roundId, f.playerId, 1,
      { kind: 'strokes', strokes: 3, dots: [initial] }, null, identifier(22960));
    const card = first.round.cards.find((entry) => entry.playerId === f.playerId);
    if (!card) throw new Error('Missing fictional card');
    const legacy = { ...initial, players: [{ playerId: f.playerId, counts: {}, calls: [{
      id: identifier(22961), kind: 'paree' as const, result: 'failure' as const,
    }] }] };
    f.seed({ ...f.row(`score-card:${f.roundId}:${f.playerId}`), content: JSON.stringify({
      playerId: card.playerId, displayName: card.displayName, updatedAt: card.updatedAt,
      holes: card.holes.map((hole) => hole.number === 1 ? { ...hole, score: { kind: 'strokes', strokes: 3, dots: [legacy] } } : hole),
    }) });
    const historic = await f.scores.get(f.actor, event.id, f.roundId);
    expect(historic.games?.results[0]?.dots?.awards).toContainEqual(expect.objectContaining({ kind: 'birdie', earnedBy: f.playerId }));
    expect(isRoundScores(historic)).toBe(true);
    const raw = await f.scores.write(f.actor, event.id, f.roundId, f.playerId, 1,
      { kind: 'strokes', strokes: 3 }, cardEtag(historic, f.playerId), identifier(22962));
    expect(raw.round.games?.results[0]?.dots).toEqual(historic.games?.results[0]?.dots);
    const peer = { playerId: f.game.playerIds[1] ?? '', counts: { dime: 1 }, calls: [] };
    const changed = { ...legacy, players: [...legacy.players, peer] };
    const edited = await f.scores.write(f.actor, event.id, f.roundId, f.playerId, 1,
      { kind: 'strokes', strokes: 3, dots: [changed] }, cardEtag(raw.round, f.playerId), identifier(22963));
    expect(edited.change.after.dots).toEqual([changed]);
    f.submit.mockClear();
    await expect(f.scores.write(f.actor, event.id, f.roundId, f.playerId, 1,
      { kind: 'strokes', strokes: 2 }, cardEtag(edited.round, f.playerId), identifier(22964)))
      .rejects.toMatchObject({ code: 'DOTS_SETUP_CHANGED' });
    expect(f.submit).not.toHaveBeenCalled();
  });

  it.each(([1, 2] as const).flatMap((version) =>
    (['birdie', 'eagle', 'string', 'birdy-string'] as const).map((kind) => ({ version, kind }))))(
    'rejects newly earned $kind from raw scoring against unchanged failed calls in v$version', async ({ version, kind }) => {
      const f = await fixture(version, true);
      const number = kind === 'birdie' || kind === 'eagle' ? 1 : 3;
      const declaration = { playerId: f.playerId, counts: {}, calls: [{
        id: identifier(22940), kind: 'paree' as const, result: 'failure' as const,
      }] };
      let round = f.round;
      for (let hole = 1; hole < number; hole++) {
        round = (await f.scores.write(f.actor, event.id, f.roundId, f.playerId, hole,
          { kind: 'strokes', strokes: kind === 'birdy-string' ? 3 : kind === 'string' && hole === 1 ? 5 : 4,
            ...(hole === 1 ? { dots: [f.record([])] } : {}) },
          cardEtag(round, f.playerId), identifier(22940 + hole))).round;
      }
      const { rotation, ...base } = f.record([declaration]);
      const record = { ...base, number, ...(number === 1 && rotation ? { rotation } : {}) };
      round = (await f.scores.write(f.actor, event.id, f.roundId, f.playerId, number,
        { kind: 'strokes', strokes: kind === 'birdy-string' ? 5 : 4, dots: [record] },
        cardEtag(round, f.playerId), identifier(22943))).round;
      const rows = new Map(f.rows);
      f.submit.mockClear();
      await expect(f.scores.write(f.actor, event.id, f.roundId, f.playerId, kind === 'string' ? 1 : number,
        { kind: 'strokes', strokes: kind === 'eagle' ? 2 : kind === 'string' ? 4 : 3 },
        cardEtag(round, f.playerId), identifier(22944))).rejects.toMatchObject({ code: 'DOTS_SETUP_CHANGED' });
      expect(f.submit).not.toHaveBeenCalled();
      expect(f.rows).toEqual(rows);
    },
  );

  it.each([1, 2] as const)('rejects mixed failed/made calls but accepts pending/zero/teammate declarations in v%i', async (version) => {
    const f = await fixture(version);
    const failure = { id: identifier(22950), kind: 'paree' as const, result: 'failure' as const };
    const success = { id: identifier(22951), kind: 'murphy' as const, result: 'success' as const };
    await expect(f.scores.write(f.actor, event.id, f.roundId, f.playerId, 1,
      { kind: 'strokes', strokes: 4, dots: [f.record([{ playerId: f.playerId, counts: {}, calls: [failure, success] }])] },
      null, identifier(22952))).rejects.toMatchObject({ code: 'DOTS_SETUP_CHANGED' });
    const players = [{ playerId: f.playerId, counts: { sandy: 0 }, calls: [failure, { ...success, id: identifier(22954), result: 'pending' as const }] },
      { playerId: f.game.playerIds[1] ?? '', counts: { sandy: 1, dime: 1 }, calls: [success] }];
    const saved = await f.scores.write(f.actor, event.id, f.roundId, f.playerId, 1,
      { kind: 'strokes', strokes: 4, dots: [f.record(players)] }, null, identifier(22953));
    expect(saved.change.after.dots?.[0]?.players).toEqual(players);
    expect(isRoundScores(saved.round)).toBe(true);
  });

  const combinations = ([1, 2] as const).flatMap((version) =>
    (['paree', 'murphy', 'pully-murphy'] as const).flatMap((kind) =>
      (['hogan', 'seve', 'sandy', 'haz-par', 'chippy', 'pully', 'dime', 'super-dime'] as const).map((special) => ({ version, kind, special }))));
  it.each(combinations)('denies new and both edit directions for failed $kind/$special in v$version without publishing writes', async ({ version, kind, special }) => {
    for (const direction of ['new', 'add-call', 'add-count'] as const) {
      const f = await fixture(version);
      const call = { id: identifier(22900), kind, result: 'failure' as const };
      let round = f.round;
      if (direction !== 'new') {
        round = (await f.scores.write(f.actor, event.id, f.roundId, f.playerId, 1,
          { kind: 'strokes', strokes: 4, dots: [f.record([{ playerId: f.playerId,
            counts: direction === 'add-call' ? { [special]: 1 } : {}, calls: direction === 'add-count' ? [call] : [] }])] },
          null, identifier(22901))).round;
      }
      const rows = new Map(f.rows);
      f.submit.mockClear();
      await expect(f.scores.write(f.actor, event.id, f.roundId, f.playerId, 1,
        { kind: 'strokes', strokes: 4, dots: [f.record([{ playerId: f.playerId, counts: { [special]: 1 }, calls: [call] }])] },
        cardEtag(round, f.playerId), identifier(22902))).rejects.toMatchObject({ status: 409, code: 'DOTS_SETUP_CHANGED' });
      expect(f.submit).not.toHaveBeenCalled();
      expect(f.rows).toEqual(rows);
    }
  });

  it.each([1, 2] as const)('keeps failed-call v%i history readable and unchanged through raw and peer edits, then permits explicit repair', async (version) => {
    const f = await fixture(version);
    const workspace = await f.workspace.get(creator, event.id);
    const snapshot = workspace.rounds.find((round) => round.id === f.roundId);
    if (!snapshot) throw new Error('Missing fictional round');
    f.seed({ ...f.row(`round:${f.roundId}`), content: JSON.stringify({ ...snapshot,
      teeProfile: { ...snapshot.teeProfile, totalPar: snapshot.teeProfile.totalPar - 1,
        holes: snapshot.teeProfile.holes.map((hole) => hole.number === 1 ? { ...hole, par: 3 } : hole) } }) });
    const call = { id: identifier(22910), kind: 'murphy' as const, result: 'pending' as const };
    const initial = f.record([{ playerId: f.playerId, counts: { sandy: 2 }, calls: [call] }]);
    let round = (await f.scores.write(f.actor, event.id, f.roundId, f.playerId, 1,
      { kind: 'strokes', strokes: 3, dots: [initial] }, null, identifier(22911))).round;
    for (const [index, playerId] of f.game.playerIds.slice(1).entries()) {
      round = (await f.scores.write(f.actor, event.id, f.roundId, playerId, 1,
        { kind: 'strokes', strokes: 3 }, null, identifier(22912 + index))).round;
    }
    const card = round.cards.find((entry) => entry.playerId === f.playerId);
    if (!card) throw new Error('Missing fictional card');
    const legacy = { ...initial, players: initial.players.map((player) => ({ ...player,
      calls: [{ ...call, result: 'failure' as const }] })) };
    f.seed({ ...f.row(`score-card:${f.roundId}:${f.playerId}`), content: JSON.stringify({
      playerId: card.playerId, displayName: card.displayName, updatedAt: card.updatedAt,
      holes: card.holes.map((hole) => hole.number === 1 ? { ...hole, score: { kind: 'strokes', strokes: 3, dots: [legacy] } } : hole),
    }) });
    const historic = await f.scores.get(f.actor, event.id, f.roundId);
    const awards = historic.games?.results[0]?.dots?.awards;
    expect(awards).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'sandy', earnedBy: f.playerId, count: 2, dots: 2 }),
      expect.objectContaining({ kind: 'murphy', earnedBy: f.playerId, dots: 1 }),
    ]));
    expect(historic.games?.results[0]?.dots?.status).not.toBe('unavailable');
    expect(isRoundScores(historic)).toBe(true);
    const capture = { ...f.row(`index-capture:${f.roundId}`) };
    const raw = await f.scores.write(f.actor, event.id, f.roundId, f.playerId, 1,
      { kind: 'strokes', strokes: 3 }, cardEtag(historic, f.playerId), identifier(22916));
    expect(raw.change.after.dots).toEqual([legacy]);
    expect(raw.round.games?.results[0]?.dots?.awards).toEqual(awards);
    const peer = { playerId: f.game.playerIds[1] ?? '', counts: { sandy: 1 }, calls: [] };
    const edited = await f.scores.write(f.actor, event.id, f.roundId, f.playerId, 1,
      { kind: 'strokes', strokes: 3, dots: [{ ...legacy, players: [...legacy.players, peer] }] },
      cardEtag(raw.round, f.playerId), identifier(22917));
    expect(edited.change.after.dots?.[0]?.players).toEqual([...legacy.players, peer]);
    expect(edited.round.games?.results[0]?.dots?.awards.filter((award) => award.earnedBy === f.playerId)).toEqual(awards);
    expect(isRoundScores(edited.round)).toBe(true);
    const contested = { ...legacy, players: [...legacy.players, peer],
      contests: [{ kind: 'kp' as const, status: 'no-qualifier' as const }] };
    const contestEdit = await f.scores.write(f.actor, event.id, f.roundId, f.playerId, 1,
      { kind: 'strokes', strokes: 3, dots: [contested] }, cardEtag(edited.round, f.playerId), identifier(22920));
    expect(contestEdit.change.after.dots).toEqual([contested]);
    f.submit.mockClear();
    await expect(f.scores.write(f.actor, event.id, f.roundId, f.playerId, 1,
      { kind: 'strokes', strokes: 3, dots: [{ ...contested, players: [
        { ...legacy.players[0], playerId: f.playerId, counts: { sandy: 3 }, calls: [{ ...call, result: 'failure' }] }, peer,
      ] }] }, cardEtag(contestEdit.round, f.playerId), identifier(22918))).rejects.toMatchObject({ code: 'DOTS_SETUP_CHANGED' });
    expect(f.submit).not.toHaveBeenCalled();
    const repaired = await f.scores.write(f.actor, event.id, f.roundId, f.playerId, 1,
      { kind: 'strokes', strokes: 3, dots: [{ ...contested, players: [
        { playerId: f.playerId, counts: {}, calls: [{ ...call, result: 'failure' }] }, peer,
      ] }] }, cardEtag(contestEdit.round, f.playerId), identifier(22919));
    expect(isRoundScores(repaired.round)).toBe(true);
    expect(f.row(`index-capture:${f.roundId}`)).toEqual(capture);
    expect(f.row(`score-change:${identifier(22911)}`)).toBeDefined();
    expect(f.rows.has(`${event.id}|score-change:${identifier(22918)}`)).toBe(false);
  });

  it.each([1, 2] as const)('accepts explicit score-derived Murphy stages in ordinary Dots v%i and preserves them on reads', async (version) => {
    const f = await fixture(version);
    let expected: string | null = null;
    for (const murphyPresses of [0, 1, 2] as const) {
      const record = f.record([{ playerId: f.playerId, counts: {}, calls: [{
        id: identifier(22800), kind: 'murphy', result: 'pending', murphyPresses, murphyTarget: 'par',
      }] }]);
      const saved = await f.scores.write(f.actor, event.id, f.roundId, f.playerId, 1,
        { kind: 'strokes', strokes: 4, dots: [record] }, expected, identifier(22801 + murphyPresses));
      expect(saved.change.after.dots).toEqual([record]);
      const read = await f.scores.get(f.actor, event.id, f.roundId);
      expect(read.games?.results[0]?.dots?.awards).toContainEqual(expect.objectContaining({
        kind: 'murphy', count: 1 + murphyPresses, multiplier: 1,
      }));
      expect(isRoundScores(read)).toBe(true);
      expected = read.cards.find((entry) => entry.playerId === f.playerId)?.etag ?? null;
    }
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
