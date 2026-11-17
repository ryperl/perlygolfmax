import type { NassauHoleRecord } from '../../domain/nassau';
import type { HoleScore, RoundScores } from '../../domain/scoring';
import { supportsRoundGame } from '../../domain/scoring';
import type { WolfHoleRecord } from '../../domain/wolf';
import { wolfForHole } from '../../domain/wolf';
import { NassauHoleControls } from '../nassau';
import { WolfHoleControls } from '../wolf';

export interface RoundGameHoleControlsProps {
  readonly round: RoundScores;
  readonly groupNumber: number;
  readonly holeNumber: number;
  readonly saved: HoleScore;
  readonly draft?: { readonly nassau?: readonly NassauHoleRecord[]; readonly wolf?: readonly WolfHoleRecord[] } | undefined;
  readonly disabled: boolean;
  readonly onNassauChange: (records: readonly NassauHoleRecord[]) => void;
  readonly onWolfChange: (records: readonly WolfHoleRecord[]) => void;
}

export function RoundGameHoleControls({ round, groupNumber, holeNumber, saved, draft, disabled, onNassauChange, onWolfChange }: RoundGameHoleControlsProps) {
  const games = round.games?.configuration.games.filter((game) =>
    (game.kind === 'nassau' || game.kind === 'wolf') && game.groupNumber === groupNumber) ?? [];
  const etag = round.games?.configuration.etag;
  if (games.length === 0) return null;
  return <div className="round-game-hole-controls">{games.map((game) => {
    const locked = disabled || round.eventStatus === 'archived' || !etag || !supportsRoundGame(round, game.kind ?? 'stableford');
    if (game.kind === 'nassau') return <div key={game.id}>
      {!supportsRoundGame(round, 'nassau') && <p>Nassau declarations unavailable: API support is required.</p>}
      <NassauHoleControls game={game} result={round.games?.results.find((result) => result.gameId === game.id)?.nassau}
        holeNumber={holeNumber} etag={etag ?? ''} disabled={locked}
        saved={saved.nassau?.find((record) => record.gameId === game.id && record.number === holeNumber)}
        draft={draft?.nassau?.find((record) => record.gameId === game.id && record.number === holeNumber)}
        onChange={(record) => { onNassauChange([...(draft?.nassau ?? []).filter((entry) => entry.gameId !== game.id), record]); }} />
    </div>;
    if (game.kind === 'wolf') return <div key={game.id}>
      {!supportsRoundGame(round, 'wolf') && <p>Wolf declarations unavailable: API support is required.</p>}
      <WolfHoleControls game={game} wolfId={wolfForHole(game, round, holeNumber)} players={round.cards}
        holeNumber={holeNumber} etag={etag ?? ''} disabled={locked}
        saved={saved.wolf?.find((record) => record.choice.gameId === game.id && record.number === holeNumber)}
        draft={draft?.wolf?.find((record) => record.choice.gameId === game.id && record.number === holeNumber)}
        onChange={(record) => { onWolfChange([...(draft?.wolf ?? []).filter((entry) => entry.choice.gameId !== game.id), record]); }} />
    </div>;
    return null;
  })}</div>;
}
