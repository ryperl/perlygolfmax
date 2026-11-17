import type { NassauHoleRecord } from '../../domain/nassau';
import type { HoleScore, RoundScores } from '../../domain/scoring';
import { supportsRoundGame } from '../../domain/scoring';
import type { WolfHoleRecord } from '../../domain/wolf';
import { wolfForHole } from '../../domain/wolf';
import { NassauHoleControls } from '../nassau';
import { WolfHoleControls } from '../wolf';
import type { DotsHoleRecord } from '../../domain/dots';
import { DotsHoleControls } from '../dots';

export interface RoundGameHoleControlsProps {
  readonly round: RoundScores;
  readonly groupNumber: number;
  readonly holeNumber: number;
  readonly saved: HoleScore;
  readonly draft?: { readonly nassau?: readonly NassauHoleRecord[]; readonly wolf?: readonly WolfHoleRecord[]; readonly dots?: readonly DotsHoleRecord[] } | undefined;
  readonly disabled: boolean;
  readonly onNassauChange: (records: readonly NassauHoleRecord[]) => void;
  readonly onWolfChange: (records: readonly WolfHoleRecord[]) => void;
  readonly onSpecialDotsChange?: (records: readonly DotsHoleRecord[]) => void;
}

export function RoundGameHoleControls({ round, groupNumber, holeNumber, saved, draft, disabled, onNassauChange, onWolfChange, onSpecialDotsChange }: RoundGameHoleControlsProps) {
  const games = round.games?.configuration.games.filter((game) =>
    (game.kind === 'nassau' || game.kind === 'wolf' || game.kind === 'dots') && game.groupNumber === groupNumber) ?? [];
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
      <WolfHoleControls game={game} wolfId={game.version === 2
        ? round.games?.results.find((result) => result.gameId === game.id)?.wolf?.holes.find((hole) => hole.number === holeNumber)?.wolfId ?? null
        : wolfForHole(game, round, holeNumber)} players={round.cards}
        comeback={round.games?.results.find((result) => result.gameId === game.id)?.wolf?.comeback}
        holeNumber={holeNumber} etag={etag ?? ''} disabled={locked || game.version === 2 && !round.wolfRulesVersions?.includes(2)}
        saved={saved.wolf?.find((record) => record.choice.gameId === game.id && record.number === holeNumber)}
        draft={draft?.wolf?.find((record) => record.choice.gameId === game.id && record.number === holeNumber)}
        onChange={(record) => { onWolfChange([...(draft?.wolf ?? []).filter((entry) => entry.choice.gameId !== game.id), record]); }} />
    </div>;
    if (game.kind === 'dots') return <DotsHoleControls key={game.id} game={game} holeNumber={holeNumber}
      par={round.layout.find((hole) => hole.number === holeNumber)?.par ?? 0} etag={etag ?? ''} players={round.cards}
      playerPars={game.playerIds.map((playerId) => ({ playerId,
        par: round.playerTees?.find((entry) => entry.playerId === playerId)?.profile.holes.find((hole) => hole.number === holeNumber)?.par
          ?? round.layout.find((hole) => hole.number === holeNumber)?.par ?? 0 }))}
      saved={saved.dots?.find((record) => record.gameId === game.id && record.number === holeNumber)}
      draft={draft?.dots?.find((record) => record.gameId === game.id && record.number === holeNumber)}
      context={game.mode === 'linked' ? round.games?.results.find((result) => result.gameId === game.linkedGameId)?.wolf?.contexts
        ?.find((context) => context.number === holeNumber) : undefined}
      disabled={locked || !onSpecialDotsChange}
      onChange={(record) => { onSpecialDotsChange?.([...(draft?.dots ?? []).filter((entry) => entry.gameId !== game.id), record]); }} />;
    return null;
  })}</div>;
}
