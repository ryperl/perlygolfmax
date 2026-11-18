import type { ChurchyGameDefinitionV3, ChurchySpecialsV3 } from '../../domain/churchy';
import { churchyDotsDefinition, churchyV3Context, churchyV3Records } from '../../domain/churchy';
import type { RoundScores } from '../../domain/scoring';
import { DotsEntryButton, DotsHoleControls } from '../dots';
import { ChurcieOrderControls } from './ChurcieOrderControls';

export function ChurcieEntryControls({ round, game, holeNumber, saved, draft, disabled, playerId, orderOnly = false, onChange }: {
  readonly round: RoundScores;
  readonly game: ChurchyGameDefinitionV3;
  readonly holeNumber: number;
  readonly saved: ChurchySpecialsV3 | undefined;
  readonly draft: ChurchySpecialsV3 | undefined;
  readonly disabled: boolean;
  readonly playerId?: string | undefined;
  readonly orderOnly?: boolean;
  readonly onChange: (record: ChurchySpecialsV3) => void;
}) {
  const etag = round.games?.configuration.etag;
  const records = churchyV3Records(game, round.groups, round.cards);
  const input = { layout: round.layout, groups: round.groups, cards: round.cards };
  const acknowledged = churchyV3Context(game, input, records);
  const value: ChurchySpecialsV3 = draft ?? saved ?? {
    version: 3, gameId: game.id, gameEtag: etag ?? '', number: holeNumber, players: [], contests: [],
  };
  const preview = churchyV3Context(game, input, draft
    ? [...records.filter((record) => record.number !== holeNumber), draft] : records);
  const locked = disabled || !etag || round.churchyEnabled !== true || !round.churchyRulesVersions?.includes(3);
  const players = game.playerIds.flatMap((id) => round.cards.filter((card) => card.playerId === id));
  if (orderOnly) {
    if (game.orderMode === 'approach' && !acknowledged.rotation && holeNumber !== acknowledged.firstHole) {
      return <p className="game-hint">Churchie partners pending. Choose the approach order on hole {acknowledged.firstHole ?? '—'}.
        Raw scores can still be saved.</p>;
    }
    return <ChurcieOrderControls mode={game.orderMode} value={preview.rotation?.playerIds ?? []} players={players}
      circuit={acknowledged.contexts.map((context) => context.number)}
      saved={acknowledged.rotation !== undefined} late={acknowledged.rotation?.recordedLate === true}
      disabled={locked} onChange={(ids) => {
        const { rotation: previous, ...rest } = value;
        void previous;
        onChange(ids.length ? { ...rest, gameEtag: etag ?? '', rotation: { playerIds: ids } } : { ...rest, gameEtag: etag ?? '' });
      }} />;
  }
  if (!playerId) {
    const par = round.layout.find((hole) => hole.number === holeNumber)?.par;
    const contests = game.specials.some((special) => special.kind === 'kp' && par === 3
      || (special.kind === 'blue-plate' || special.kind === 'long-drive') && par === 5
      || special.kind === 'assassin' && (par === 3 || par === 5));
    const selected = value.contests.length > 0 || value.players.some((player) => player.calls.length > 0
      || Object.values(player.counts).some((count) => count !== 0));
    if (!contests && !selected) return null;
  }
  const controls = <DotsHoleControls game={churchyDotsDefinition({ ...game, name: 'Churchie' })} holeNumber={holeNumber}
    par={round.layout.find((hole) => hole.number === holeNumber)?.par ?? 0}
    playerPars={game.playerIds.map((id) => ({ playerId: id,
      par: round.playerTees?.find((entry) => entry.playerId === id)?.profile.holes.find((hole) => hole.number === holeNumber)?.par
        ?? round.layout.find((hole) => hole.number === holeNumber)?.par ?? 0 }))}
    etag={etag ?? ''} saved={saved} draft={draft} players={players} contextLabel="Churchie partner order"
    context={preview.contexts.find((context) => context.number === holeNumber)}
    contextPreview={draft?.rotation !== undefined && acknowledged.rotation === undefined}
    specialLabels={{ dime: 'Sticky' }} allowMurphyPresses
    playerId={playerId} groupOnly={playerId === undefined} disabled={locked}
    onChange={(record) => { onChange({ ...record, version: 3 }); }} />;
  return playerId ? <DotsEntryButton name={players.find((player) => player.playerId === playerId)?.displayName ?? 'Golfer unavailable'}
    gameName="Churchie" holeNumber={holeNumber} disabled={locked}
    staged={draft?.players.some((player) => player.playerId === playerId) === true}>{controls}</DotsEntryButton> : controls;
}
