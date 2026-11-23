import { dotsCoexistenceWriteIssues, dotsSpecialCatalog } from '../../domain/dots';
import type { DotsContest, DotsGameDefinition, DotsHoleRecord, DotsPlayerDeclaration, DotsRotationContext, DotsSpecialKind } from '../../domain/dots';
import type { DotHoleContext } from '../../domain/dot-context';
import type { HoleScore } from '../../domain/scoring';
import { DotsPlayerControls } from './DotsPlayerControls';
import { DotsRotationControls } from './DotsRotationControls';
import { coexistenceMessage } from './coexistence-message';
import './dots-entry.css';

export function DotsHoleControls({ game, holeNumber, par, playerPars, etag, saved, draft, players, context, disabled, onChange,
  playerId: selectedPlayerId, groupOnly = false, rotation, rotationLocked = false, specialLabels, contextLabel = 'Wolf',
  contextPreview = false, allowMurphyPresses = false, scoreDerivedMurphy = false, scoreDerivedParee = false, scoreDerivedPullyMurphy = false, playerScores, showRotation = true, coexistenceRules = false }: {
  readonly game: DotsGameDefinition;
  readonly holeNumber: number;
  readonly par: number;
  readonly playerPars?: readonly { readonly playerId: string; readonly par: number }[] | undefined;
  readonly etag: string;
  readonly saved: DotsHoleRecord | undefined;
  readonly draft: DotsHoleRecord | undefined;
  readonly players: readonly { readonly playerId: string; readonly displayName: string }[];
  readonly context?: DotHoleContext | undefined;
  readonly disabled: boolean;
  readonly onChange: (record: DotsHoleRecord) => void;
  readonly playerId?: string | undefined;
  readonly groupOnly?: boolean;
  readonly rotation?: DotsRotationContext | undefined;
  readonly rotationLocked?: boolean;
  readonly specialLabels?: Readonly<Partial<Record<DotsSpecialKind, string>>> | undefined;
  readonly contextLabel?: string;
  readonly contextPreview?: boolean;
  readonly allowMurphyPresses?: boolean;
  readonly scoreDerivedMurphy?: boolean;
  readonly scoreDerivedParee?: boolean;
  readonly scoreDerivedPullyMurphy?: boolean;
  readonly playerScores?: readonly { readonly playerId: string; readonly score: HoleScore | undefined }[] | undefined;
  readonly showRotation?: boolean;
  readonly coexistenceRules?: boolean;
}) {
  const record = draft ?? saved ?? { number: holeNumber, gameId: game.id, gameEtag: etag, players: [], contests: [] };
  const enabled = (kind: string) => game.specials.some((special) => special.kind === kind);
  const name = (id: string) => players.find((player) => player.playerId === id)?.displayName ?? 'Golfer unavailable';
  const sides = game.mode === 'fixed' ? [game.partnerIds.slice(0, 2), game.partnerIds.slice(2)]
    : (game.mode === 'linked' || game.mode === 'rotating') && context?.status === 'ready' ? context.sides : [];
  const partnered = sides.length === 2 && sides.every((side) => side.length === 2);
  const ownSide = selectedPlayerId ? sides.find((side) => side.includes(selectedPlayerId)) : undefined;
  const teammates = ownSide?.filter((id) => id !== selectedPlayerId) ?? [];
  const eligibleContests = (['kp', 'blue-plate', 'long-drive'] satisfies readonly DotsContest['kind'][]).filter((kind) =>
    (enabled(kind) || kind !== 'long-drive' && enabled('assassin')) && par === (kind === 'kp' ? 3 : 5));
  const hasSelections = (value: DotsHoleRecord | undefined) => value !== undefined
    && (value.contests.length > 0 || value.players.some((player) => player.calls.length > 0
      || Object.values(player.counts).some((count) => count !== 0)));
  const clearable = hasSelections(record);
  if (groupOnly && !selectedPlayerId && (game.mode !== 'rotating' || !showRotation) && game.mode !== 'linked'
    && eligibleContests.length === 0 && !clearable && !hasSelections(saved)) return null;
  function changePlayer(player: DotsPlayerDeclaration) {
    onChange({ ...record, gameEtag: etag, players: [...record.players.filter((entry) => entry.playerId !== player.playerId), player] });
  }
  function changeContest(contest: DotsContest) {
    onChange({ ...record, gameEtag: etag, contests: [...record.contests.filter((entry) => entry.kind !== contest.kind), contest] });
  }
  function contestIssues(playerId: string, contest: DotsContest) {
    if (!coexistenceRules) return [];
    const declaration = record.players.find((player) => player.playerId === playerId) ?? { playerId, counts: {}, calls: [] };
    return dotsCoexistenceWriteIssues(declaration, {
      score: playerScores?.find((player) => player.playerId === playerId)?.score,
      par: playerPars?.find((player) => player.playerId === playerId)?.par ?? par,
      categoryPar: par,
      contests: [...record.contests.filter((entry) => entry.kind !== contest.kind), contest],
    }).conflicts.filter((issue) => issue.kinds.includes(contest.kind));
  }
  return <fieldset disabled={disabled}><legend>{game.name} specials · Hole {holeNumber}</legend>
    {!selectedPlayerId && showRotation && game.mode === 'rotating' && rotation && <DotsRotationControls game={game} holeNumber={holeNumber}
      record={record} rotation={rotation} locked={rotationLocked} players={players}
      onChange={(value) => { onChange({ ...value, gameEtag: etag }); }} />}
    {selectedPlayerId && game.mode === 'rotating' && <p className="dots-entry-partner">{context?.status === 'ready'
      ? `Partner: ${context.sides.find((side) => side.includes(selectedPlayerId))
        ?.filter((id) => id !== selectedPlayerId).map(name).join(' + ') ?? 'Pending'}${rotationLocked ? '' : ' · Preview'}`
      : 'Partner order pending. Choose P1–P4 above the score fields.'}</p>}
    {selectedPlayerId && game.mode === 'fixed' && <p className="dots-entry-partner">
      Fixed partner: {teammates.map(name).join(' + ')} · All round
    </p>}
    {selectedPlayerId && game.mode === 'linked' && <p className="dots-entry-partner">{context?.status !== 'ready'
      ? `Partners pending saved ${contextLabel} choice`
      : teammates.length === 0 ? `Solo · ×${String(context.multiplier)}`
        : `${teammates.length === 1 ? 'Partner' : 'Teammates'}: ${teammates.map(name).join(' + ')} · ×${String(context.multiplier)}${contextPreview ? ' · Unsaved partner preview' : ''}`}</p>}
    {!selectedPlayerId && game.mode === 'linked' && <p>{context?.status === 'ready'
      ? `${context.sides.map((side) => side.map(name).join(' + ')).join(' vs ')} · ×${String(context.multiplier)}${contextPreview ? ' · Unsaved partner preview' : ''}`
      : `Linked sides are pending saved ${contextLabel} choices. Results use the authoritative saved context.`}</p>}
    {!groupOnly && game.playerIds.filter((playerId) => !selectedPlayerId || selectedPlayerId === playerId).map((playerId) => {
      const declaration = record.players.find((entry) => entry.playerId === playerId) ?? { playerId, counts: {}, calls: [] };
      const controls = <DotsPlayerControls game={game} declaration={declaration} name={name(playerId)}
        par={playerPars?.find((entry) => entry.playerId === playerId)?.par ?? par}
        saved={saved?.players.find((entry) => entry.playerId === playerId)} onChange={changePlayer} specialLabels={specialLabels}
        allowMurphyPresses={allowMurphyPresses} scoreDerivedMurphy={scoreDerivedMurphy} scoreDerivedParee={scoreDerivedParee}
        scoreDerivedPullyMurphy={scoreDerivedPullyMurphy}
        coexistenceRules={coexistenceRules} contests={record.contests} categoryPar={par}
        score={playerScores?.find((entry) => entry.playerId === playerId)?.score} />;
      return selectedPlayerId ? <div key={playerId}>{controls}</div>
        : <details key={playerId}><summary>{name(playerId)} · Specials and calls</summary>{controls}</details>;
    })}
    {!selectedPlayerId && eligibleContests.map((kind) => {
      const contest = record.contests.find((entry) => entry.kind === kind);
      const label = dotsSpecialCatalog.find((special) => special.kind === kind)?.label;
      return <div key={kind}><label>{label} result<select value={contest?.status === 'no-qualifier' ? 'none' : contest?.winnerId ?? ''}
        onChange={(event) => {
          if (event.target.value === 'none') changeContest({ kind, status: 'no-qualifier' });
          else if (game.playerIds.includes(event.target.value)) changeContest({ kind, status: 'awarded', winnerId: event.target.value });
          else onChange({ ...record, gameEtag: etag, contests: record.contests.filter((entry) => entry.kind !== kind) });
        }}><option value="">Decision pending</option><option value="none">No qualifier · Carry category</option>
          {game.playerIds.map((id) => <option key={id} value={id} disabled={contest?.winnerId !== id
            && contestIssues(id, { kind, status: 'awarded', winnerId: id }).length > 0}>{name(id)}</option>)}</select></label>
        <small>{kind === 'long-drive' ? 'Par-5 fairway qualifier.' : `Par-${kind === 'kp' ? '3' : '5'} GIR qualifier.`} Missing input is pending, never no qualifier.</small>
        {enabled('assassin') && partnered && contest?.status === 'awarded' && <label>
          {label} {kind === 'long-drive' ? 'second-longest' : 'second-closest'} qualifier · Assassin<select value={contest.secondId ?? ''} onChange={(event) => {
            const secondId = event.target.value;
            const { secondId: previous, ...rest } = contest;
            void previous;
            changeContest(secondId ? { ...rest, secondId } : rest);
          }}><option value="">Not relevant</option>{game.playerIds.filter((id) => id !== contest.winnerId).map((id) =>
            <option key={id} value={id} disabled={contest.secondId !== id && contestIssues(id, { ...contest, secondId: id }).length > 0}>{name(id)}</option>)}</select>
          <small>Optional. Assassin requires teammates ahead of both opponents; only the first golfer wins the category.</small>
        </label>}
        {coexistenceRules && contest?.status === 'awarded' && [...new Set([contest.winnerId, contest.secondId])]
          .filter((id): id is string => id !== undefined).flatMap((id) => contestIssues(id, contest).map((issue) =>
            <p role="alert" key={`${id}:${issue.kinds.join(':')}`}>{name(id)}: {coexistenceMessage(issue, (kind) =>
              dotsSpecialCatalog.find((special) => special.kind === kind)?.label ?? kind)} Correct the conflicting claim or change this category selection.</p>))}
        {coexistenceRules && (kind === 'kp' || kind === 'long-drive') && record.players.some((player) =>
          (player.counts.seve ?? 0) > 0 || kind === 'kp' && (player.counts.sandy ?? 0) > 0)
          && <small>{label} excludes a source golfer&apos;s {kind === 'kp' ? 'Seve or Sandy' : 'Seve'} on this hole. Teammates may earn separate awards.</small>}
      </div>;
    })}
    {!selectedPlayerId && <button type="button" disabled={!clearable} onClick={() => {
      if (clearable) onChange({ ...record, gameEtag: etag, players: [], contests: [] });
    }}>
      Clear {game.name} hole specials</button>}
  </fieldset>;
}
