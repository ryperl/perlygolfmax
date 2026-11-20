import type { RoundScores, Scorecard } from '../../domain/scoring';
import type { DotAward } from '../../domain/dot-context';
import type { ScorecardGame } from './scorecard-presentation';
import { dotsSpecialCatalog } from '../../domain/dots';

export interface DotHoleBreakdown {
  readonly status: 'complete' | 'pending' | 'unavailable';
  readonly base: number | null;
  readonly specials: number | null;
  readonly total: number | null;
  readonly entries: readonly { readonly label: string; readonly dots: number; readonly source: string | null; readonly lane: 'base' | 'specials' }[];
  readonly context: string;
}
const exact = (values: readonly number[]): number | null => {
  const total = values.reduce((sum, value) => sum + BigInt(value), 0n);
  return total >= BigInt(Number.MIN_SAFE_INTEGER) && total <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(total) : null;
};
const awardLabel = (kind: string, mode?: 'partner' | 'blind' | 'pig') => kind === 'wolf-low' && mode && mode !== 'partner'
  ? mode === 'pig' ? 'PIG' : 'Blind Wolf' : ({ 'wolf-high': 'High', 'wolf-low': 'Low', 'wolf-solo': 'Solo Wolf',
  'wolf-sweep': 'High/Low Sweep', high: 'High', low: 'Low', 'category-sweep': 'Category Sweep' }[kind]
  ?? dotsSpecialCatalog.find((special) => special.kind === kind)?.label ?? kind);

export function dotHoleBreakdown(game: ScorecardGame, playerId: string, number: number,
  players: readonly Pick<Scorecard, 'playerId' | 'displayName'>[], round?: RoundScores): DotHoleBreakdown {
  const entries: DotHoleBreakdown['entries'][number][] = [];
  const add = (awards: readonly DotAward[], lane: 'base' | 'specials', mode?: 'partner' | 'blind' | 'pig') => {
    for (const award of awards.filter((award) => award.number === number && award.recipientIds.includes(playerId))) {
      entries.push({ label: `${awardLabel(award.kind, mode)}${award.reason.includes('call: failure') ? ' · missed call' : ''}`, dots: award.dots, lane,
        source: award.earnedBy ? players.find((player) => player.playerId === award.earnedBy)?.displayName ?? 'Golfer unavailable' : null });
    }
  };
  let status: DotHoleBreakdown['status'] = 'unavailable';
  let total: number | null = null;
  let context = game.definition.name;
  const result = game.result;
  const definition = game.definition;
  if (definition.kind === 'dots') {
    const hole = result?.dots?.holes.find((hole) => hole.number === number);
    status = hole?.status === 'complete' ? 'complete' : hole?.status === 'pending' ? 'pending' : 'unavailable';
    total = hole?.points.find((point) => point.playerId === playerId)?.dots ?? null;
    add(hole?.awards ?? [], 'specials');
    if (definition.mode === 'linked') {
      const linked = round?.games?.configuration.games.find((entry) => entry.id === definition.linkedGameId);
      if (linked?.kind === 'wolf' && linked.version === 2 && linked.groupNumber === definition.groupNumber
        && linked.playerIds.length === definition.playerIds.length && linked.playerIds.every((id) => definition.playerIds.includes(id))) {
        const base = round?.games?.results.find((entry) => entry.gameId === linked.id)?.wolf;
        const baseHole = base?.holes.find((hole) => hole.number === number);
        add(base?.awards ?? [], 'base', baseHole?.mode ?? undefined);
        status = status === 'unavailable' || !baseHole || baseHole.status === 'unavailable' ? 'unavailable'
          : status === 'pending' || baseHole.status === 'pending' ? 'pending' : 'complete';
        const value = baseHole?.transfers.find((point) => point.playerId === playerId)?.dots;
        total = total !== null && value !== undefined ? exact([total, value]) : null;
        context = `${linked.name} + ${game.definition.name} · Cell shows specials; breakdown includes linked base`;
      } else {
        status = 'unavailable'; total = null;
        context = 'Linked base results unavailable';
      }
    } else context += ' · Specials-only game';
  } else if (game.definition.kind === 'wolf') {
    const hole = result?.wolf?.holes.find((hole) => hole.number === number);
    status = !hole || hole.status === 'unavailable' ? 'unavailable' : hole.status === 'pending' ? 'pending' : 'complete';
    total = hole?.transfers.find((point) => point.playerId === playerId)?.dots ?? null;
    if (game.definition.version === 2) add(result?.wolf?.awards ?? [], 'base', hole?.mode ?? undefined);
    else {
      context += ' · Legacy signed dot balance';
      if (total !== null) entries.push({ label: 'Wolf transfer balance', dots: total, lane: 'base', source: null });
    }
  } else if (game.definition.kind === 'churchy') {
    const hole = result?.churchy?.holes.find((hole) => hole.number === number);
    status = !hole || hole.dotStatus === 'unavailable' ? 'unavailable'
      : hole.dotStatus === 'complete' ? 'complete' : 'pending';
    total = hole?.awards.find((point) => point.playerId === playerId)?.dots ?? null;
    if (hole) {
      for (const lane of ['high', 'low'] as const) {
        if (hole[lane].dots !== null && hole[lane].winners.includes(playerId)) {
          entries.push({ label: lane === 'high' ? 'High' : 'Low', dots: hole[lane].dots, lane: 'base', source: null });
        }
      }
      for (const award of hole.specials.filter((award) => award.winners.includes(playerId) && award.dots !== 0)) {
        entries.push({ label: `${award.special}${award.outcome === 'missed' ? ' · missed call' : ''}`, dots: award.dots,
          lane: 'specials', source: award.playerId ? players.find((player) => player.playerId === award.playerId)?.displayName ?? 'Golfer unavailable' : null });
      }
    }
  }
  const base = status === 'complete' ? exact(entries.filter((entry) => entry.lane === 'base').map((entry) => entry.dots)) : null;
  const specials = status === 'complete' ? exact(entries.filter((entry) => entry.lane === 'specials').map((entry) => entry.dots)) : null;
  if (status === 'complete' && (base === null || specials === null || total === null || exact([base, specials]) !== total)) {
    status = 'unavailable';
  }
  return { status, base: status === 'complete' ? base : null, specials: status === 'complete' ? specials : null,
    total: status === 'complete' ? total : null, entries, context };
}
