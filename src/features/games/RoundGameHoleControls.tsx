import { Fragment } from 'react';
import type { NassauHoleRecord } from '../../domain/nassau';
import type { HoleScore, RoundScores } from '../../domain/scoring';
import { supportsDotsSpecials, supportsIndividualDotsPlayerCount, supportsRoundGame } from '../../domain/scoring';
import type { WolfHoleRecord } from '../../domain/wolf';
import { wolfForHole } from '../../domain/wolf';
import { NassauHoleControls } from '../nassau';
import { WolfHoleControls } from '../wolf';
import type { DotsHoleRecord } from '../../domain/dots';
import { dotsRotationContext } from '../../domain/dots';
import { DotsEntryButton, DotsHoleControls, DotsRotationControls } from '../dots';
import { groupStartingHole } from '../../domain/round-navigation';
import type { ChurchySpecials, ChurchySpecialsV3 } from '../../domain/churchy';
import { ChurcieEntryControls } from '../churchy';

export interface RoundGameHoleControlsProps {
  readonly round: RoundScores;
  readonly groupNumber: number;
  readonly holeNumber: number;
  readonly playerId?: string;
  readonly playerScore?: HoleScore | null | undefined;
  readonly playerScores?: readonly { readonly playerId: string; readonly score: HoleScore | undefined }[] | undefined;
  readonly placement?: 'before' | 'other';
  readonly saved: HoleScore;
  readonly draft?: { readonly nassau?: readonly NassauHoleRecord[]; readonly wolf?: readonly WolfHoleRecord[]; readonly dots?: readonly DotsHoleRecord[];
    readonly churchy?: ChurchySpecials } | undefined;
  readonly disabled: boolean;
  readonly onNassauChange: (records: readonly NassauHoleRecord[]) => void;
  readonly onWolfChange: (records: readonly WolfHoleRecord[]) => void;
  readonly onSpecialDotsChange?: (records: readonly DotsHoleRecord[]) => void;
  readonly onChurchyChange?: (record: ChurchySpecialsV3) => void;
}

export function RoundGameHoleControls({ round, groupNumber, holeNumber, saved, draft, disabled, onNassauChange, onWolfChange, onSpecialDotsChange, onChurchyChange, playerId, playerScore, playerScores, placement }: RoundGameHoleControlsProps) {
  const games = round.games?.configuration.games.filter((game) =>
    (game.kind === 'nassau' || game.kind === 'match-play' || game.kind === 'wolf' || game.kind === 'dots'
      || game.kind === 'churchy' && game.version === 3 && round.churchyEnabled === true) && game.groupNumber === groupNumber
    && (placement !== 'before' || game.kind === 'wolf' || game.kind === 'churchy' || game.kind === 'dots' && game.version === 2)
    && (placement !== 'other' || game.kind !== 'wolf')
    && (!playerId || (game.kind === 'dots' || game.kind === 'churchy') && game.playerIds.includes(playerId))) ?? [];
  const etag = round.games?.configuration.etag;
  if (games.length === 0) return null;
  return <div className="round-game-hole-controls">{games.map((game) => {
    const locked = disabled || round.eventStatus === 'archived' || !etag || !supportsRoundGame(round, game.kind ?? 'stableford');
    if (game.kind === 'churchy' && game.version === 3) {
      return <ChurcieEntryControls key={game.id} round={round} game={game} holeNumber={holeNumber}
        saved={saved.churchy?.version === 3 && saved.churchy.gameId === game.id ? saved.churchy : undefined}
        draft={draft?.churchy?.version === 3 && draft.churchy.gameId === game.id ? draft.churchy : undefined}
        playerId={playerId} playerScore={playerScore} orderOnly={placement === 'before'} disabled={locked || !onChurchyChange}
        playerScores={playerScores}
        onChange={(record) => { onChurchyChange?.(record); }} />;
    }
    if (game.kind === 'nassau' || game.kind === 'match-play') return <div key={game.id}>
      {!supportsRoundGame(round, game.kind) && <p>{game.kind === 'match-play' ? 'Match Play' : 'Nassau'} declarations unavailable: API support is required.</p>}
      <NassauHoleControls game={game} result={round.games?.results.find((result) => result.gameId === game.id)?.nassau}
        holeNumber={holeNumber} etag={etag ?? ''} disabled={locked}
        saved={saved.nassau?.find((record) => record.gameId === game.id && record.number === holeNumber)}
        draft={draft?.nassau?.find((record) => record.gameId === game.id && record.number === holeNumber)}
        onChange={(record) => { onNassauChange([...(draft?.nassau ?? []).filter((entry) => entry.gameId !== game.id), record]); }} />
    </div>;
    if (game.kind === 'wolf') {
      const result = round.games?.results.find((result) => result.gameId === game.id)?.wolf;
      const layout = [...round.layout].sort((a, b) => a.number - b.number);
      const start = layout.findIndex((hole) => hole.number === groupStartingHole(round.groups.find((group) => group.number === groupNumber), layout));
      const prefix = [...layout.slice(start), ...layout.slice(0, start)].slice(0, -2);
      const reviewMessages = prefix.flatMap((hole) => {
        const saved = result?.holes.find((entry) => entry.number === hole.number);
        if (saved?.status === 'pending' && saved.mode === null && saved.wolfId) return [`Hole ${String(hole.number)}: record ${round.cards.find((card) => card.playerId === saved.wolfId)?.displayName ?? 'the golfer'}'s Wolf declaration.`];
        if (saved?.status === 'pending') return [`Hole ${String(hole.number)}: save all group scores.`];
        if (saved?.status === 'unavailable') return [`Hole ${String(hole.number)}: review Wolf scores and captured inputs.`];
        return [];
      });
      for (const linked of round.games?.configuration.games.filter((entry) => entry.kind === 'dots'
        && entry.mode === 'linked' && entry.linkedGameId === game.id) ?? []) {
        const dots = round.games?.results.find((entry) => entry.gameId === linked.id)?.dots;
        if (dots?.holes.some((hole) => prefix.some((entry) => entry.number === hole.number) && hole.status !== 'complete')) {
          reviewMessages.push(`${linked.name}: review pending or unavailable specials on earlier holes.`);
        }
      }
      return <div key={game.id}>
      {!supportsRoundGame(round, 'wolf') && <p>Wolf declarations unavailable: API support is required.</p>}
      {game.version === 2 && game.highLowSweep === true && round.wolfHighLowSweep !== true
        && <p>Wolf High/Low Sweep declarations require advertised API support.</p>}
      <WolfHoleControls game={game} wolfId={game.version === 2
        ? result?.holes.find((hole) => hole.number === holeNumber)?.wolfId ?? null
        : wolfForHole(game, round, holeNumber)} players={round.cards}
        comeback={result?.comeback} holes={result?.holes} reviewMessages={reviewMessages}
        holeNumber={holeNumber} etag={etag ?? ''} disabled={locked || game.version === 2
          && (!round.wolfRulesVersions?.includes(2) || game.highLowSweep === true && round.wolfHighLowSweep !== true)}
        saved={saved.wolf?.find((record) => record.choice.gameId === game.id && record.number === holeNumber)}
        draft={draft?.wolf?.find((record) => record.choice.gameId === game.id && record.number === holeNumber)}
        onChange={(record) => { onWolfChange([...(draft?.wolf ?? []).filter((entry) => entry.choice.gameId !== game.id), record]); }} />
    </div>;
    }
    if (game.kind === 'dots') {
      const anchor = round.groups.find((group) => group.number === groupNumber)?.playerIds[0];
      const records = round.cards.find((card) => card.playerId === anchor)?.holes.flatMap((hole) => hole.score.dots ?? [])
        .filter((record) => record.gameId === game.id) ?? [];
      const staged = draft?.dots?.find((record) => record.gameId === game.id && record.number === holeNumber);
      const rotation = game.version === 2 ? dotsRotationContext(game, round, staged
        ? [...records.filter((record) => record.number !== holeNumber), staged] : records) : undefined;
      const rotationLocked = records.some((record) => record.rotation !== undefined);
      const individualUnsupported = game.mode === 'individual' && !supportsIndividualDotsPlayerCount(round, game.playerIds.length);
      const dotsLocked = locked || !onSpecialDotsChange || individualUnsupported || !supportsDotsSpecials(round, game.specials)
        || game.version === 2 && !round.dotsRulesVersions?.includes(2)
        || game.sweepRule === 'manual-v1' && round.dotsManualSweep !== true;
      if (placement === 'before' && game.version === 2 && rotation) {
        const record = staged ?? saved.dots?.find((record) => record.gameId === game.id && record.number === holeNumber)
          ?? { number: holeNumber, gameId: game.id, gameEtag: etag ?? '', players: [], contests: [] };
        return <fieldset key={game.id} disabled={dotsLocked}><legend>{game.name}</legend>
          {!round.dotsRulesVersions?.includes(2) && <p>Rotating Dots edits require advertised API version-2 support.</p>}
          <DotsRotationControls game={game} holeNumber={holeNumber} record={record} rotation={rotation}
            locked={rotationLocked} players={round.cards}
            onChange={(record) => { onSpecialDotsChange?.([...(draft?.dots ?? []).filter((entry) => entry.gameId !== game.id),
              { ...record, gameEtag: etag ?? '' }]); }} />
        </fieldset>;
      }
      const controls = <DotsHoleControls game={game} holeNumber={holeNumber}
      par={round.layout.find((hole) => hole.number === holeNumber)?.par ?? 0} etag={etag ?? ''} players={round.cards}
      playerPars={game.playerIds.map((playerId) => ({ playerId,
        par: round.playerTees?.find((entry) => entry.playerId === playerId)?.profile.holes.find((hole) => hole.number === holeNumber)?.par
          ?? round.layout.find((hole) => hole.number === holeNumber)?.par ?? 0 }))}
      scoreDerivedMurphy={round.dotsCallTargets === true} scoreDerivedParee={round.dotsCallTargets === true}
      coexistenceRules={round.dotsCoexistenceRulesVersion === 2}
      allowMurphyPresses={round.dotsCallTargets === true}
      playerScores={playerScores ?? round.cards.map((card) => ({ playerId: card.playerId,
        score: (card.playerId === playerId && playerScore !== undefined
          ? playerScore : card.holes.find((hole) => hole.number === holeNumber)?.score) ?? undefined }))}
      saved={saved.dots?.find((record) => record.gameId === game.id && record.number === holeNumber)}
      draft={draft?.dots?.find((record) => record.gameId === game.id && record.number === holeNumber)}
      context={game.mode === 'linked' ? round.games?.results.find((result) => result.gameId === game.linkedGameId)?.wolf?.contexts
        ?.find((context) => context.number === holeNumber) : rotation?.contexts.find((context) => context.number === holeNumber)}
      playerId={playerId} groupOnly={!playerId} rotation={rotation} rotationLocked={rotationLocked}
      showRotation={placement !== 'other'}
      disabled={dotsLocked}
      onChange={(record) => { onSpecialDotsChange?.([...(draft?.dots ?? []).filter((entry) => entry.gameId !== game.id), record]); }} />;
      return playerId ? <DotsEntryButton key={game.id} name={round.cards.find((card) => card.playerId === playerId)?.displayName ?? 'Golfer unavailable'}
        gameName={game.name} holeNumber={holeNumber} showGameName={games.filter((entry) => entry.kind === 'dots').length > 1}
        disabled={dotsLocked} staged={staged?.players.some((player) => player.playerId === playerId) === true}>
        {controls}
      </DotsEntryButton> : <Fragment key={game.id}>
        {individualUnsupported && <p>Individual Dots edits for this group size require advertised API support.</p>}
        {game.version === 2 && !round.dotsRulesVersions?.includes(2) && <p>Rotating Dots edits require advertised API version-2 support.</p>}
        {game.sweepRule === 'manual-v1' && round.dotsManualSweep !== true && <p>Manual Sweep edits require advertised API support.</p>}
        {controls}
      </Fragment>;
    }
    return null;
  })}</div>;
}
