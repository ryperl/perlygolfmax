import { describe, expect, it } from 'vitest';
import { fictionalId } from '../../client/catalog.test-support';
import { maximumExactGamePoints } from '../../domain/games';
import { addBand, buildGame, draftFromGame, newGameDraft, replaceGame, setPreset } from './game-draft';

describe('game drafts', () => {
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
      rows: [{ scoreToPar: -4, points: 12 }, ...buildGame(modified)?.points.rows ?? [], { scoreToPar: 3, points: -7 }],
    });
    expect(draftFromGame(buildGame(extended) ?? failGame())).toEqual(extended);
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
});

function failGame(): never {
  throw new Error('Expected a valid fictional game.');
}
