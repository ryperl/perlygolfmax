import { parseScoreEntry, scoreEntryText } from '../../contracts/scoring';
import type { HoleScore, RoundScores, ScoreChange, Scorecard } from '../../domain/scoring';
import type { ChurchySpecials } from '../../domain/churchy';

export interface HoleDraft {
  readonly churchy?: ChurchySpecials;
  readonly text: string;
  readonly baseEtag: string | null;
  readonly status: 'draft' | 'saving' | 'failed' | 'conflict';
  readonly attempt?: { readonly id: string; readonly etag: string | null; readonly sent: boolean };
  readonly mustWrite?: boolean;
  readonly conflictAt?: number;
  readonly acknowledged?: ScoreChange;
}

export function entryKey(playerId: string, holeNumber: number): string {
  return `${playerId}:${String(holeNumber)}`;
}

export function savedHole(card: Scorecard, holeNumber: number): HoleScore {
  return card.holes.find((hole) => hole.number === holeNumber)?.score ?? { kind: 'unplayed' };
}

export function cardFor(round: RoundScores, playerId: string): Scorecard {
  const card = round.cards.find((item) => item.playerId === playerId);
  if (!card) throw new Error('Saved group player is missing a scorecard. Refresh before entering scores.');
  return card;
}

export function editedDraft(text: string, card: Scorecard, previous?: HoleDraft): HoleDraft {
  return {
    text, baseEtag: previous ? previous.baseEtag : card.etag,
    ...(previous?.churchy ? { churchy: previous.churchy } : {}),
    status: previous?.status === 'conflict' ? 'conflict' : 'draft',
    ...(previous?.conflictAt !== undefined ? { conflictAt: previous.conflictAt } : {}),
    ...(previous?.mustWrite || previous?.attempt?.sent ? { mustWrite: true } : {}),
    ...(previous?.acknowledged ? { acknowledged: previous.acknowledged } : {}),
  };
}

export function conflictedDraft(score: HoleScore, card: Scorecard, refreshVersion: number, previous?: HoleDraft, acknowledged?: ScoreChange): HoleDraft {
  return {
    text: previous?.text ?? scoreEntryText(score), baseEtag: previous ? previous.baseEtag : card.etag,
    ...(previous?.churchy ?? score.churchy ? { churchy: previous?.churchy ?? score.churchy } : {}),
    status: 'conflict', conflictAt: refreshVersion,
    ...(previous?.attempt ? { attempt: previous.attempt } : {}),
    ...(acknowledged ? { acknowledged } : previous?.acknowledged ? { acknowledged: previous.acknowledged } : {}),
  };
}

export function scoreLabel(score: HoleScore): string {
  switch (score.kind) {
    case 'strokes': return `${String(score.strokes)} strokes`;
    case 'unplayed': return 'Unplayed';
    case 'picked-up': return score.reportedStrokes === undefined ? 'X — picked up' : `X${String(score.reportedStrokes)} — picked up; ${String(score.reportedStrokes)} reported, incomplete`;
    case 'did-not-finish': return 'DNF (hole)';
  }
}

export function entryScore(text: string, churchy?: ChurchySpecials): HoleScore | null {
  const score = parseScoreEntry(text);
  return score && churchy ? { ...score, churchy } : score;
}
