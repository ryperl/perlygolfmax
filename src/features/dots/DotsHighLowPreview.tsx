import type { DotsGameDefinition, DotsHoleRecord } from '../../domain/dots';
import type { HoleScore, RoundScores } from '../../domain/scoring';
import { scoreEntryText } from '../../contracts/scoring';
import { calculateDotsHighLow } from '../../domain/dots-high-low';
import { dotsRecordsFor } from '../../domain/game-declarations';

export function DotsHighLowPreview({ round, game, number, playerScores, record }: {
  readonly round: RoundScores;
  readonly game: DotsGameDefinition;
  readonly number: number;
  readonly playerScores?: readonly { readonly playerId: string; readonly score: HoleScore | undefined }[] | undefined;
  readonly record?: DotsHoleRecord | undefined;
}) {
  if (!game.highLow) return null;
  if (playerScores?.some((entry) => game.playerIds.includes(entry.playerId) && entry.score === undefined)) {
    return <p>High/Low preview unavailable · Check the entered scores.</p>;
  }
  const changed = record !== undefined || playerScores?.some((entry) => {
    const saved = round.cards.find((card) => card.playerId === entry.playerId)?.holes.find((hole) => hole.number === number)?.score;
    return entry.score !== undefined && (!saved || scoreEntryText(saved) !== scoreEntryText(entry.score));
  }) === true;
  const cards = round.cards.map((card) => {
    const entered = playerScores?.find((entry) => entry.playerId === card.playerId)?.score;
    return entered === undefined ? card : { ...card, holes: card.holes.map((hole) =>
      hole.number === number ? { ...hole, score: entered } : hole) };
  });
  const savedRecords = dotsRecordsFor(game, round.groups, round.cards);
  const result = changed ? calculateDotsHighLow(game, { ...round, cards }, record
    ? [...savedRecords.filter((entry) => entry.number !== record.number), record] : savedRecords)
    : round.games?.results.find((entry) => entry.gameId === game.id)?.dotsHighLow;
  const hole = result?.holes.find((entry) => entry.number === number);
  const name = (id: string) => round.cards.find((card) => card.playerId === id)?.displayName ?? 'Golfer unavailable';
  return <section className="entry-net-comparison" aria-label={`${game.name} net comparison`}>
    <strong>{changed ? 'Preview' : 'Saved'} High/Low</strong>
    {!hole ? <p>Comparison unavailable. Refresh to retry.</p> : <>
      {hole.contests.map((contest) => <p key={contest.kind}>
        {contest.kind === 'high' ? 'High' : 'Low'} {contest.aScore ?? '—'} vs {contest.bScore ?? '—'} · {
          contest.status === 'tied' ? 'Push' : contest.status === 'pending' ? 'Pending scores or order'
            : contest.status === 'unavailable' ? 'Unavailable'
              : `${contest.winnerIds.map(name).join(' + ')} +1 each`}
      </p>)}
      {game.highLow.version === 2 && <p>Automatic High/Low Sweep · {
        result?.awards.filter((award) => award.number === number && award.kind === 'high-low-sweep')
          .map((award) => `${award.recipientIds.map(name).join(' + ')} +1 each`).join(', ')
        || (hole.status === 'complete' ? 'None' : hole.status === 'pending' ? 'Pending' : 'Unavailable')}
      </p>}
    </>}
  </section>;
}
