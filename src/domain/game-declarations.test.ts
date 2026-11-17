import { describe, expect, it } from 'vitest';
import type { NassauHoleRecord, NassauManualPress } from './nassau.js';
import { nassauMatchId } from './nassau.js';
import type { HoleScore } from './scoring.js';
import { preserveScoreExtras, sameHoleScore, supportsRoundGame } from './scoring.js';
import { mergeNassauRecords, mergeWolfRecords, nassauContextFromScores, scoreDeclarationIntent, scoreMatchesIntent } from './game-declarations.js';
import { matchGamesFixture } from './match-games.test-support.js';
import { strokeGameId } from './stroke-games.test-support.js';

describe('saved game declaration merging', () => {
  const f = matchGamesFixture();
  const matchId = nassauMatchId(f.nassau.id, 0, 1);
  const press: NassauManualPress = { id: strokeGameId(980), matchId, parentBetId: `${matchId}:front`,
    startHole: 3, declaredAfterHole: 2, pressingSide: 'b', proof: 'nassau-v1:[]' };
  const record: NassauHoleRecord = { number: 3, gameId: f.nassau.id, gameEtag: 'fictional-game-revision',
    outcomes: [{ matchId, outcome: 'side-a' }], presses: [press] };

  it('merges patches per game, preserves presses and clears only an explicitly reverted match outcome', () => {
    const peer = { ...record, gameId: strokeGameId(979), presses: [] };
    const changed = mergeNassauRecords([{ ...record, outcomes: [{ matchId, outcome: 'scores' }], presses: [] }], [record, peer]);
    expect(changed).toEqual([{ ...record, outcomes: [] }, peer]);
    expect(mergeNassauRecords([], [record])).toEqual([record]);
    const appended = { ...press, id: strokeGameId(981), parentBetId: `${matchId}:overall` };
    expect(mergeNassauRecords([{ ...record, outcomes: [], presses: [appended] }], [record])[0]?.presses).toEqual([press, appended]);
    expect(record.outcomes).toEqual([{ matchId, outcome: 'side-a' }]);
    expect(mergeNassauRecords([{ ...record, outcomes: [], presses: [] }])).toEqual([]);
    expect(mergeNassauRecords([{ ...record, outcomes: [{ matchId, outcome: 'scores' }], presses: [] }],
      [{ ...record, presses: [] }])).toEqual([]);
  });

  it('rejects reusing a press identity for different content instead of silently replacing a saved receipt', () => {
    const invalid = { ...record, presses: [{ ...press, pressingSide: 'a' as const }] };
    expect(() => mergeNassauRecords([invalid], [record])).toThrow('cannot be replaced');
    expect(scoreMatchesIntent({ kind: 'unplayed', nassau: [record] }, { kind: 'unplayed', nassau: [invalid] })).toBe(false);
  });

  it('preserves hidden namespaces on raw-only clients and avoids echoing old receipts into bounded requests', () => {
    const saved: HoleScore = { kind: 'strokes', strokes: 4, nassau: [record] };
    const raw: HoleScore = { kind: 'strokes', strokes: 5 };
    expect(preserveScoreExtras(raw, saved)).toEqual({ ...raw, nassau: [record] });
    expect(scoreDeclarationIntent({ ...raw, nassau: [record] }, saved)).toEqual(raw);
    expect(sameHoleScore(saved, { kind: 'strokes', strokes: 4 })).toBe(false);
    expect(scoreMatchesIntent(saved, { kind: 'strokes', strokes: 4 })).toBe(true);
  });

  it('retains authoritative late-choice metadata and does not erase manual outcomes through omission', () => {
    const saved = { number: 3, choice: { gameId: f.wolf.id, gameEtag: 'fictional-game-revision', mode: 'pig' as const },
      recordedLate: true as const, outcome: 'wolf' as const };
    expect(mergeWolfRecords([{ number: 3, choice: saved.choice }], [saved])).toEqual([saved]);
    expect(mergeWolfRecords([{ number: 3, choice: saved.choice, outcome: 'scores' }], [saved])).toEqual([
      { number: 3, choice: saved.choice, recordedLate: true },
    ]);
  });

  it('reconstructs only captured public context, with no fabricated profiles or private handicap observations', () => {
    const round = f.round();
    const context = nassauContextFromScores(round);
    expect(context?.teeProfile).toEqual({ id: f.snapshot.teeProfile.id, holes: round.layout,
      holeCount: 18, strokeAllocation: true });
    expect(context?.courseVersionId).toBe(f.snapshot.courseVersionId);
    expect(JSON.stringify(context)).not.toMatch(/handicapIndex|recordedBy|effectiveDate|ratings|totalMeters/);
    const { gameInputContext: metadata, ...old } = round;
    expect(metadata).toBeDefined();
    expect(nassauContextFromScores(old)).toBeNull();
  });

  it('requires explicit new-kind capabilities while retaining old API baseline and Churchy flag behavior', () => {
    for (const kind of ['stroke-play', 'wolf', 'nassau'] as const) {
      expect(supportsRoundGame({}, kind)).toBe(false);
      expect(supportsRoundGame({ supportedGameKinds: [kind] }, kind)).toBe(true);
    }
    expect(supportsRoundGame({}, 'stableford')).toBe(true);
    expect(supportsRoundGame({}, 'churchy')).toBe(false);
    expect(supportsRoundGame({ churchyEnabled: true }, 'churchy')).toBe(true);
    expect(supportsRoundGame({ supportedGameKinds: ['churchy'], churchyEnabled: false }, 'churchy')).toBe(false);
  });
});
