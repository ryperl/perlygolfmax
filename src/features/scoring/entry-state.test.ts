import { describe, expect, it } from 'vitest';
import { fictionalChange, fictionalRoundScores, scoreResult } from '../../client/scoring.test-support';
import { cardFor, conflictedDraft, editedDraft, entryKey, entryScore, savedHole, scoreLabel } from './entry-state';
import { churchyFixture } from '../../domain/churchy.test-support';
import type { DotsHoleRecord } from '../../domain/dots';
import { fictionalId } from '../../client/catalog.test-support';

describe('hole entry state', () => {
  it('retains explicit Dots replacement and stable calls across raw edits and conflicts without copying hidden saved extras', () => {
    const card = cardFor(fictionalRoundScores, fictionalChange.playerId);
    const dots: readonly DotsHoleRecord[] = [{ number: 1, gameId: fictionalChange.id, gameEtag: 'fictional-game-v1',
      players: [{ playerId: card.playerId, counts: { sandy: 2 }, calls: [{ id: fictionalId(982), kind: 'paree', result: 'failure' }] }],
      contests: [] }];
    const original = { ...editedDraft('', card, undefined, false), dots };
    const edited = editedDraft('X7', card, original);
    expect(edited.dots).toEqual(dots);
    const score = entryScore(edited.text, undefined, undefined, undefined, undefined, edited.dots);
    if (!score) throw new Error('Missing fictional Dots disposition');
    expect(score).toEqual({ kind: 'picked-up', reportedStrokes: 7, dots });
    expect(conflictedDraft(score, card, 2, edited)).toMatchObject({ dots, status: 'conflict' });
    expect(conflictedDraft(score, card, 2).dots).toBeUndefined();
    expect(entryScore('', undefined, undefined, undefined, undefined, [])).toEqual({ kind: 'unplayed', dots: [] });
  });
  it('retains staged match patches across raw edits and conflicts without copying saved declaration history into commands', () => {
    const card = cardFor(fictionalRoundScores, fictionalChange.playerId);
    const wolf = [{ number: 1, choice: { gameId: fictionalChange.id, gameEtag: 'fictional-game-v1', mode: 'blind' as const } }];
    const nassau = [{ number: 1, gameId: fictionalChange.id, gameEtag: 'fictional-game-v1', outcomes: [], presses: [] }];
    const original = { ...editedDraft('', card, undefined, false), wolf, nassau };
    const edited = editedDraft('X7', card, original);
    expect(edited).toMatchObject({ wolf, nassau, rawEdited: true });
    const score = entryScore(edited.text, undefined, undefined, edited.nassau, edited.wolf);
    if (!score) throw new Error('Missing fictional match disposition');
    expect(score).toEqual({ kind: 'picked-up', reportedStrokes: 7, wolf, nassau });
    expect(conflictedDraft(score, card, 2, edited)).toMatchObject({ wolf, nassau, status: 'conflict' });
    const rawOnly = conflictedDraft(score, card, 2);
    expect(rawOnly.wolf).toBeUndefined();
    expect(rawOnly.nassau).toBeUndefined();
  });
  it('retains Churchy selections and press intent when raw strokes change, fail, or need conflict review', () => {
    const f = churchyFixture();
    const card = f.cards[0];
    if (!card) throw new Error('Missing fictional golfer');
    const original = { ...editedDraft('4', card), churchy: { ...f.extras, murphy: true, murphyPresses: 2 as const } };
    const edited = editedDraft('X7', card, original);
    expect(edited.churchy).toEqual(original.churchy);
    const score = entryScore(edited.text, edited.churchy);
    if (!score) throw new Error('Missing fictional disposition');
    expect(score).toMatchObject({ kind: 'picked-up', reportedStrokes: 7, churchy: original.churchy });
    expect(conflictedDraft(score, card, 1, edited).churchy).toEqual(original.churchy);
  });
  it('captures a null baseline once and never silently adopts a later projection during further edits', () => {
    const original = cardFor(fictionalRoundScores, fictionalChange.playerId);
    const draft = editedDraft('4', original);
    const later = cardFor(scoreResult().round, fictionalChange.playerId);
    expect(editedDraft('5', later, draft).baseEtag).toBeNull();
    expect(editedDraft('5', later).baseEtag).toBe('card-v2');
  });
  it('changes explicit intent without reusing its request ID or forgetting an earlier uncertain write', () => {
    const card = cardFor(fictionalRoundScores, fictionalChange.playerId);
    const uncertain = { ...editedDraft('4', card), attempt: { id: fictionalChange.id, etag: null, sent: true }, status: 'failed' as const };
    const next = editedDraft('', card, uncertain);
    expect(next.attempt).toBeUndefined();
    expect(next.mustWrite).toBe(true);
    expect(next.baseEtag).toBeNull();
    expect(entryScore(next.text)).toEqual({ kind: 'unplayed' });
  });
  it('keeps conflict review and definitive audit acknowledgement separate from a later projection', () => {
    const card = cardFor(scoreResult().round, fictionalChange.playerId);
    const draft = conflictedDraft({ kind: 'picked-up', reportedStrokes: 7 }, card, 3, undefined, fictionalChange);
    expect(draft).toMatchObject({ text: 'X7', status: 'conflict', conflictAt: 3, acknowledged: fictionalChange });
    expect(editedDraft('X8', card, draft)).toMatchObject({ text: 'X8', status: 'conflict', conflictAt: 3 });
  });
  it('uses shared blank/X/X7/DNF parsing, never turning pickup into a completed numeric score', () => {
    expect(entryScore('')).toEqual({ kind: 'unplayed' });
    expect(entryScore('X7')).toEqual({ kind: 'picked-up', reportedStrokes: 7 });
    expect(entryScore('DNF')).toEqual({ kind: 'did-not-finish' });
    expect(entryScore('X0')).toBeNull();
    expect(scoreLabel({ kind: 'picked-up', reportedStrokes: 7 })).toBe('X7 — picked up; 7 reported, incomplete');
    expect(entryKey(fictionalChange.playerId, 1)).not.toBe(entryKey(fictionalChange.playerId, 2));
    expect(savedHole(cardFor(fictionalRoundScores, fictionalChange.playerId), 1)).toEqual({ kind: 'unplayed' });
    expect(() => cardFor(fictionalRoundScores, 'missing')).toThrow('missing a scorecard');
  });
});
