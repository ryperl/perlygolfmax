import { describe, expect, it } from 'vitest';
import { fictionalId } from '../../client/catalog.test-support';
import { maximumExactGamePoints, teamSize } from '../../domain/games';
import { teamLeaderboardGame, teamLeaderboardRound } from '../../client/leaderboard.test-support';
import { addBand, buildGame, draftFromGame, newGameDraft, replaceGame, resetTeamAssignments, setFormat, setPreset, teamDraftFeedback } from './game-draft';

describe('game drafts', () => {
  it.each([2, 12, 40])('builds exact two-person teams for a %i-golfer full roster without an arbitrary cap', (count) => {
    const ids = Array.from({ length: count }, (_, index) => fictionalId(index + 1));
    const draft = setFormat(newGameDraft(), 'two-net-better-ball', count);
    const complete = { ...draft, teams: draft.teams?.map((team, index) => ({ ...team, playerIds: ids.slice(index * 2, index * 2 + 2) })) };
    expect(teamDraftFeedback(complete, ids)).toBeNull();
    expect(buildGame(complete, ids)).not.toBeNull();
    expect(teamDraftFeedback(complete, [...ids, fictionalId(count + 1)])).toContain('cannot form full 2-person teams');
  });
  it.each([4, 12, 40])('builds exact four-person teams for a %i-golfer full roster', (count) => {
    const ids = Array.from({ length: count }, (_, index) => fictionalId(index + 1));
    const draft = setFormat(newGameDraft(), 'four-two-net', count);
    const complete = { ...draft, teams: draft.teams?.map((team, index) => ({ ...team, playerIds: ids.slice(index * 4, index * 4 + 4) })) };
    expect(teamDraftFeedback(complete, ids)).toBeNull();
    expect(buildGame(complete, ids)).not.toBeNull();
    expect(teamDraftFeedback(complete, ids.slice(1))).toContain('cannot form full 4-person teams');
  });
  it('creates a fresh standard seed with 95% allowance and independent points rows', () => {
    const first = newGameDraft();
    const second = newGameDraft();
    expect(first.id).not.toBe(second.id);
    expect(first.allowance).toBe('95');
    expect(first.rows.map((row) => [row.scoreToPar, row.points])).toEqual([
      [-4, '6'], [-3, '5'], [-2, '4'], [-1, '3'], [0, '2'], [1, '1'], [2, '0'],
    ]);
    expect([first.better, first.worse]).toEqual(['6', '0']);
    expect(first.rows).not.toBe(second.rows);
    expect(buildGame(first)?.handicapAllowancePercent).toBe(95);
  });

  it('seeds modified explicitly, preserves identity, and supports contiguous extra bands and editable tails', () => {
    const initial = newGameDraft();
    const modified = setPreset(initial, 'modified');
    expect(modified.id).toBe(initial.id);
    expect(modified.rows.map((row) => [row.scoreToPar, row.points])).toEqual([
      [-3, '8'], [-2, '5'], [-1, '2'], [0, '0'], [1, '-1'], [2, '-2'],
    ]);
    expect([modified.better, modified.worse]).toEqual(['8', '-2']);
    const extended = addBand(addBand({ ...modified, better: '12', worse: '-7' }, 'better'), 'worse');
    expect(buildGame(extended)?.points).toMatchObject({
      betterScorePoints: 12, worseScorePoints: -7,
      rows: [{ scoreToPar: -4, points: 12 }, ...buildGame(modified)?.points?.rows ?? [], { scoreToPar: 3, points: -7 }],
    });
    expect(draftFromGame(buildGame(extended) ?? failGame())).toEqual({ ...extended, allowanceConfigured: true });
  });

  it.each(['', ' ', '1.2', '1e2', 'Infinity', 'NaN', '9007199254740992', String(maximumExactGamePoints + 1)])(
    'rejects invalid points %j rather than converting blanks to zero', (value) => {
      expect(buildGame({ ...newGameDraft(), better: value })).toBeNull();
      expect(buildGame({ ...newGameDraft(), worse: value })).toBeNull();
      const draft = newGameDraft();
      expect(buildGame({ ...draft, rows: draft.rows.map((row) => ({ ...row, points: value })) })).toBeNull();
    },
  );

  it.each(['', '0', '-1', '101', '1.5', '2e1', '9007199254740992'])('rejects invalid net allowance %j', (allowance) => {
    expect(buildGame({ ...newGameDraft(), basis: 'net', allowance })).toBeNull();
    expect(buildGame({ ...newGameDraft(), basis: 'gross', allowance })?.handicapAllowancePercent).toBe(95);
  });

  it('accepts zero and negative points and allowance boundaries without changing raw strokes', () => {
    for (const allowance of ['1', '100']) {
      const game = buildGame({ ...newGameDraft(), basis: 'net', allowance, better: '0', worse: '-10' });
      expect(game).toMatchObject({
        handicapAllowancePercent: Number(allowance),
        points: { betterScorePoints: 0, worseScorePoints: -10 },
      });
    }
  });

  it('validates names and constructed contiguous rows through the shared guard', () => {
    expect(buildGame({ ...newGameDraft(), name: ' ' })).toBeNull();
    expect(buildGame({ ...newGameDraft(), name: 'x'.repeat(101) })).toBeNull();
    expect(buildGame({ ...newGameDraft(), name: 'Bad\nname' })).toBeNull();
    const draft = newGameDraft();
    expect(buildGame({ ...draft, rows: draft.rows.filter((row) => row.scoreToPar !== 0) })).toBeNull();
  });

  it('bounds extra rows and game count and replaces only the selected definition', () => {
    let draft = newGameDraft();
    for (let index = 0; index < 40; index++) draft = addBand(draft, 'better');
    expect(draft.rows).toHaveLength(32);
    expect(addBand(draft, 'worse')).toBe(draft);
    const first = buildGame(newGameDraft()) ?? failGame();
    const peer = { ...first, id: fictionalId(502), name: 'Fictional peer game' };
    const updated = { ...first, name: 'Fictional edited game' };
    expect(replaceGame([first, peer], updated)).toEqual([updated, peer]);
    const full = Array.from({ length: 16 }, (_, index) => ({ ...first, id: fictionalId(600 + index) }));
    expect(replaceGame(full, first)).toBeNull();
    expect(replaceGame([first, first], updated)).toBeNull();
  });

  it('creates empty team slots without partner inference and preserves explicitly configured allowance', () => {
    const team = setFormat(newGameDraft(), 'two-net-better-ball', 6);
    expect(team.allowance).toBe('100');
    expect(team.basis).toBe('net');
    expect(team.teams).toHaveLength(3);
    expect(team.teams?.flatMap((entry) => entry.playerIds)).toEqual(['', '', '', '', '', '']);
    expect(buildGame(team, teamLeaderboardRound.cards.map((card) => card.playerId))).toBeNull();
    const saved = draftFromGame({ ...teamLeaderboardGame, handicapAllowancePercent: 95 });
    expect(setFormat(saved, 'two-net-aggregate', 6)).toMatchObject({ teams: saved.teams, allowance: '95' });
    expect(setPreset(setFormat(saved, 'two-net-aggregate', 6), 'standard').allowance).toBe('95');
    expect(setFormat({ ...team, allowance: '87', allowanceConfigured: true }, 'four-two-net', 8)).toMatchObject({
      allowance: '87', assignmentsCleared: true, teams: [
        { playerIds: ['', '', '', ''] }, { playerIds: ['', '', '', ''] },
      ],
    });
  });

  it('round-trips valid assignments and rejects missing, duplicate, stale and incompatible rosters', () => {
    const ids = teamLeaderboardRound.cards.map((card) => card.playerId);
    const draft = draftFromGame(teamLeaderboardGame);
    expect(buildGame(draft, ids)).toEqual(teamLeaderboardGame);
    expect(teamDraftFeedback(draft, ids)).toBeNull();
    expect(buildGame(draft, ids.slice(0, 4))).toBeNull();
    expect(buildGame({ ...draft, teams: draft.teams?.map((team) => ({ ...team, playerIds: [ids[0] ?? '', ''] })) }, ids)).toBeNull();
    expect(buildGame({ ...draft, format: 'four-two-net' }, ids)).toBeNull();
    expect(teamDraftFeedback({ ...draft, format: 'four-two-net' }, ids)).toContain('6 golfers cannot form full 4-person teams');
    expect(buildGame({ ...draft, teams: draft.teams?.map((team) => ({ ...team, name: '' })) }, ids)).toBeNull();
    expect(buildGame(draft)).toBeNull();
  });

  it.each([
    ['two-net-better-ball', 'standard'], ['two-net-aggregate', 'standard'],
    ['four-two-net', 'standard'], ['four-two-net', 'modified'],
  ] as const)('builds the requested %s / %s choice with editable independent points and allowance', (format, preset) => {
    const roster = Array.from({ length: 8 }, (_, index) => fictionalId(1000 + index));
    const seed = setPreset(setFormat(newGameDraft(), format, roster.length), preset);
    const draft = { ...seed, allowance: '91', teams: seed.teams?.map((team, index) => ({
      ...team, playerIds: roster.slice(index * teamSize(format), (index + 1) * teamSize(format)),
    })) };
    expect(buildGame(draft, roster)).toMatchObject({ format, preset, basis: 'net', handicapAllowancePercent: 91 });
    expect(setPreset(draft, preset === 'standard' ? 'modified' : 'standard')).toMatchObject({
      format, teams: draft.teams, allowance: '91',
    });
  });

  it('resets team slot count explicitly after roster growth or shrink and retains saved individual allowances', () => {
    const draft = draftFromGame(teamLeaderboardGame);
    expect(resetTeamAssignments(draft, 4).teams).toHaveLength(2);
    expect(resetTeamAssignments(draft, 8).teams).toHaveLength(4);
    expect(resetTeamAssignments(draft, 4).teams?.flatMap((team) => team.playerIds)).toEqual(['', '', '', '']);
    const gross = { id: fictionalId(1100), name: 'Fictional saved gross', preset: 'standard' as const,
      basis: 'gross' as const, handicapAllowancePercent: 100, points: teamLeaderboardGame.points };
    expect(buildGame(draftFromGame(gross))).toEqual(gross);
  });
});

function failGame(): never {
  throw new Error('Expected a valid fictional game.');
}
