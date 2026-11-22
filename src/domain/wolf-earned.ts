import type { DotAward, DotHoleContext } from './dot-context.js';
import type { Scorecard } from './scoring.js';
import { groupStartingHole } from './round-navigation.js';
import { hasStrokeAllocation } from './tees.js';
import { handicapStrokesForHole } from './handicap-strokes.js';
import { compareHighLow } from './high-low.js';
import { wolfForHole, wolfGroupMatchesRound, wolfOrder } from './wolf.js';
import type {
  WolfComebackReceipt, WolfComebackState, WolfContestResult, WolfGameDefinition,
  WolfHoleRecord, WolfHoleResult, WolfResults, WolfRoundInput, WolfUnavailableReason,
} from './wolf.js';

function exact(value: bigint): number | null {
  return value < BigInt(Number.MIN_SAFE_INTEGER) || value > BigInt(Number.MAX_SAFE_INTEGER) ? null : Number(value);
}

function empty(number: number, wolfId: string | null, reason?: WolfUnavailableReason): WolfHoleResult {
  return { number, wolfId, mode: null, wolfSide: [], opponents: [], status: reason ? 'unavailable' : 'pending',
    ...(reason ? { reason } : {}), source: 'scores', winner: null, wolfScore: null, opponentScore: null,
    stake: null, transfers: [], contests: [] };
}

function receiptKey(receipt: WolfComebackReceipt): string {
  return JSON.stringify([receipt.wolfId, receipt.afterHoles,
    receipt.totals.map(({ playerId, dots }) => [playerId, dots]), receipt.proof]);
}

export function calculateEarnedWolf(
  game: WolfGameDefinition, round: WolfRoundInput, cards: readonly Scorecard[], records: readonly WolfHoleRecord[],
): WolfResults {
  const layout = [...round.layout].sort((a, b) => a.number - b.number);
  const players = game.playerIds.flatMap((id) => {
    const player = round.players.find((entry) => entry.playerId === id);
    return player ? [player] : [];
  });
  const invalid = !wolfGroupMatchesRound(game, round) || players.length !== 4
    || new Set(layout.map((hole) => hole.number)).size !== layout.length
    || players.some((player) => player.layout.length !== layout.length
      || new Set(player.layout.map((hole) => hole.number)).size !== layout.length
      || player.layout.some((hole) => !layout.some((common) => common.number === hole.number)));
  if (invalid) return { rulesVersion: 2, status: 'unavailable', reason: 'invalid-wolf-group',
    holes: layout.map((hole) => empty(hole.number, null, 'invalid-wolf-group')), players: [], awards: [], contexts: [],
    comeback: { status: 'unavailable', receipt: null, changed: false, reason: 'invalid-wolf-group' } };

  const group = round.groups.find((entry) => entry.number === game.groupNumber);
  const start = layout.findIndex((hole) => hole.number === groupStartingHole(group, layout));
  const circuit = [...layout.slice(start), ...layout.slice(0, start)];
  const prefix = circuit.slice(0, -2).map((hole) => hole.number);
  const finals = circuit.slice(-2).map((hole) => hole.number);
  const handicaps = new Map<string, number>();
  let netReason: WolfUnavailableReason | undefined;
  if (game.basis === 'net') {
    for (const player of players) {
      if (typeof player.handicap !== 'number' || !Number.isSafeInteger(player.handicap)) {
        netReason = typeof player.handicap === 'string' ? player.handicap : 'missing-handicap-index';
        break;
      }
      if (!hasStrokeAllocation({ holes: player.layout, strokeAllocation: player.strokeAllocation === true })) {
        netReason = 'missing-stroke-index';
        break;
      }
    }
    if (!netReason) {
      const minimum = Math.min(...players.map((player) => typeof player.handicap === 'number' ? player.handicap : 0));
      for (const player of players) {
        if (typeof player.handicap !== 'number') continue;
        const relative = game.handicapRule ? gameHandicap(game.handicapRule, player.playerId, round.players, round.groups)
          : exact(BigInt(player.handicap) - BigInt(minimum));
        if (typeof relative !== 'number') { netReason = relative ?? 'arithmetic-range'; break; }
        handicaps.set(player.playerId, relative);
      }
    }
  }
  const orphan = records.some((record) => !layout.some((hole) => hole.number === record.number));
  function holeResult(number: number, wolfId: string | null): WolfHoleResult {
    const entries = records.filter((record) => record.number === number);
    if (orphan || entries.length > 1) return empty(number, wolfId, 'invalid-wolf-choice');
    if (!wolfId) return empty(number, null);
    const record = entries[0];
    if (!record) return empty(number, wolfId);
    const choice = record.choice;
    if (choice.mode === 'order') return empty(number, wolfId);
    if (choice.gameId !== game.id || choice.mode === 'pig' && !game.allowPig
      || choice.mode === 'partner' && (choice.partnerId === wolfId || !game.playerIds.includes(choice.partnerId))
      || record.outcome !== undefined && record.outcome !== 'scores') return empty(number, wolfId, 'invalid-wolf-choice');
    const wolfSide = choice.mode === 'partner' ? [wolfId, choice.partnerId] : [wolfId];
    const opponents = game.playerIds.filter((id) => !wolfSide.includes(id));
    const stake = choice.mode === 'pig' ? 3 : choice.mode === 'blind' ? 2 : 1;
    const base: WolfHoleResult = { ...empty(number, wolfId), mode: choice.mode, wolfSide, opponents, stake,
      ...(record.recordedLate ? { recordedLate: true } : {}) };
    const raw = game.playerIds.map((id) => cards.find((card) => card.playerId === id)?.holes.find((hole) => hole.number === number)?.score);
    const kinds: readonly WolfContestResult['kind'][] = choice.mode === 'partner' ? ['high', 'low'] : ['low'];
    const unresolved = (status: 'pending' | 'unavailable', reason?: WolfUnavailableReason): WolfHoleResult => ({
      ...base, status, ...(reason ? { reason } : {}), contests: kinds.map((kind) => ({
        kind, status, winner: null, wolfScore: null, opponentScore: null,
      })),
    });
    if (raw.some((score) => score === undefined)) return unresolved('unavailable', 'missing-score-data');
    if (raw.some((score) => score?.kind === 'unplayed')) return unresolved('pending');
    if (netReason) return unresolved('unavailable', netReason);
    const numeric = new Map<string, number>();
    for (const [index, player] of players.entries()) {
      const score = raw[index];
      if (score?.kind !== 'strokes') continue;
      if (!Number.isSafeInteger(score.strokes) || score.strokes < 1) return unresolved('unavailable', 'invalid-stroke-score');
      const own = player.layout.find((hole) => hole.number === number);
      if (!own) return unresolved('unavailable', 'missing-score-data');
      let received = 0n;
      if (game.basis === 'net') {
        const handicap = handicaps.get(player.playerId);
        if (handicap === undefined) return unresolved('unavailable', 'missing-handicap-index');
        received = BigInt(handicapStrokesForHole(handicap, own.allocation, player.layout.length));
      }
      const value = exact(BigInt(score.strokes) - received);
      if (value === null) return unresolved('unavailable', 'arithmetic-range');
      numeric.set(player.playerId, value);
    }
    const a = wolfSide.flatMap((id) => numeric.has(id) ? [numeric.get(id) ?? 0] : []);
    const b = opponents.flatMap((id) => numeric.has(id) ? [numeric.get(id) ?? 0] : []);
    const contests = kinds.map((kind): WolfContestResult => {
      const contest = compareHighLow(kind, a, wolfSide.length, b, opponents.length);
      return { kind, status: contest.status, winner: contest.winner === 'a' ? 'wolf' : contest.winner === 'b' ? 'opponents' : null,
        wolfScore: contest.aScore, opponentScore: contest.bScore };
    });
    const unavailable = contests.some((contest) => contest.status === 'unavailable');
    const winners = new Set(contests.flatMap((contest) => contest.winner ? [contest.winner] : []));
    const winner = winners.size === 1 ? contests.find((contest) => contest.winner)?.winner ?? null : null;
    const low = contests.find((contest) => contest.kind === 'low');
    const swept = game.highLowSweep === true && choice.mode === 'partner'
      && contests.every((contest) => contest.status === 'won' && contest.winner === winner);
    return { ...base, contests, status: unavailable ? 'unavailable' : winners.size === 1 ? 'won' : 'tied',
      ...(unavailable ? { reason: 'missing-numeric-ball' as const } : {}), winner,
      wolfScore: low?.wolfScore ?? null, opponentScore: low?.opponentScore ?? null,
      transfers: contests.some((contest) => contest.status !== 'unavailable')
        ? game.playerIds.map((playerId) => ({ playerId, dots: contests.reduce((sum, contest) => sum
          + (contest.winner && (contest.winner === 'wolf' ? wolfSide : opponents).includes(playerId) ? stake : 0), 0)
          + (swept && (winner === 'wolf' ? wolfSide : opponents).includes(playerId) ? 1 : 0) })) : [] };
  }

  const first = prefix.map((number) => holeResult(number, wolfForHole(game, round, number, records)));
  let comeback: WolfComebackState = { status: 'pending', receipt: null, changed: false };
  const points = round.comebackPoints;
  const malformedPoints = points !== undefined && (points.length !== 4 || new Set(points.map((point) => point.playerId)).size !== 4
    || points.some((point) => !game.playerIds.includes(point.playerId)
      || point.dots !== null && (!Number.isSafeInteger(point.dots) || point.dots < 0)));
  const unresolvedPoints = points?.some((point) => point.dots === null) || round.comebackRequired && points === undefined;
  if (malformedPoints || first.some((hole) => hole.status === 'unavailable')) {
    comeback = { status: 'unavailable', receipt: null, changed: false, reason: malformedPoints ? 'invalid-comeback-points' : 'unavailable-prefix' };
  } else if (!unresolvedPoints && first.every((hole) => hole.status === 'won' || hole.status === 'tied')) {
    const totals = game.playerIds.map((playerId) => ({ playerId, dots: exact(first.reduce((sum, hole) => sum
      + BigInt(hole.transfers.find((entry) => entry.playerId === playerId)?.dots ?? 0), 0n)
      + BigInt(points?.find((point) => point.playerId === playerId)?.dots ?? 0)) }));
    if (totals.some((entry) => entry.dots === null)) {
      comeback = { status: 'unavailable', receipt: null, changed: false, reason: 'arithmetic-range' };
    } else {
      const known = totals.flatMap((entry) => entry.dots === null ? [] : [{ playerId: entry.playerId, dots: entry.dots }]);
      const minimum = Math.min(...known.map((entry) => entry.dots));
      const scheduled = prefix.length % 4;
      const selectedOrder = wolfOrder(game, round, records)?.playerIds ?? [];
      const order = [...selectedOrder.slice(scheduled), ...selectedOrder.slice(0, scheduled)];
      const wolfId = order.find((id) => known.some((entry) => entry.playerId === id && entry.dots === minimum));
      if (wolfId) {
        const proof = JSON.stringify({
          game: { id: game.id, version: game.version, basis: game.basis, playerIds: game.playerIds, groupNumber: game.groupNumber, allowPig: game.allowPig,
            ...(game.handicapRule ? { handicapRule: game.handicapRule } : {}),
            ...(game.highLowSweep ? { highLowSweep: true } : {}) },
          ...(game.orderMode ? { order: wolfOrder(game, round, records) } : {}),
          group: group ? { number: group.number, playerIds: group.playerIds, startingHole: groupStartingHole(group, layout) } : null,
          circuit: circuit.map((hole) => ({ number: hole.number, par: hole.par, allocation: hole.allocation })),
          players: players.map((player) => ({ playerId: player.playerId, handicap: player.handicap,
            strokeAllocation: player.strokeAllocation, layout: player.layout.map(({ number, par, allocation }) => ({ number, par, allocation })) })),
          prefix: prefix.map((number) => ({ number, records: records.filter((record) => record.number === number)
            .map((record) => ({ choice: record.choice, outcome: record.outcome })),
          scores: game.playerIds.map((playerId) => {
            const score = cards.find((card) => card.playerId === playerId)?.holes.find((hole) => hole.number === number)?.score;
            return { playerId, kind: score?.kind, strokes: score?.kind === 'strokes' ? score.strokes : null,
              reportedStrokes: score?.kind === 'picked-up' ? score.reportedStrokes ?? null : null };
          }) })),
          linked: game.playerIds.map((playerId) => ({ playerId, dots: points?.find((point) => point.playerId === playerId)?.dots ?? 0 })),
        });
        comeback = { status: 'available', receipt: { wolfId, afterHoles: prefix, totals: known, proof }, changed: false };
      }
    }
  }
  const saved = records.flatMap((record) => record.comeback ? [{ number: record.number, receipt: record.comeback }] : []);
  const validSaved = saved.every(({ number, receipt }) => finals.includes(number) && game.playerIds.includes(receipt.wolfId)
    && JSON.stringify(receipt.afterHoles) === JSON.stringify(prefix) && typeof receipt.proof === 'string' && receipt.proof.length > 0
    && receipt.totals.length === 4 && new Set(receipt.totals.map((entry) => entry.playerId)).size === 4
    && receipt.totals.every((entry) => game.playerIds.includes(entry.playerId) && Number.isSafeInteger(entry.dots) && entry.dots >= 0));
  const persisted = saved[0]?.receipt;
  if (!validSaved || persisted && saved.some(({ receipt }) => receiptKey(receipt) !== receiptKey(persisted))) {
    comeback = { status: 'unavailable', receipt: null, changed: false, reason: 'conflicting-comeback-receipts' };
  } else if (persisted) {
    comeback = { status: 'saved', receipt: persisted,
      changed: comeback.receipt === null || receiptKey(comeback.receipt) !== receiptKey(persisted) };
  } else if (records.some((record) => finals.includes(record.number))) {
    comeback = { status: 'unavailable', receipt: null, changed: false, reason: 'missing-comeback-receipt' };
  }
  const tail = finals.map((number) => comeback.status === 'unavailable'
    ? empty(number, null, 'invalid-wolf-choice') : holeResult(number, comeback.receipt?.wolfId ?? null));
  const holes = [...first, ...tail].sort((a, b) => a.number - b.number);
  const status = holes.some((hole) => hole.status === 'unavailable') ? 'unavailable'
    : holes.every((hole) => hole.status === 'won' || hole.status === 'tied') ? 'complete' : 'in-progress';
  const contexts: readonly DotHoleContext[] = holes.map((hole) => ({
    number: hole.number, status: hole.mode === null ? hole.status === 'unavailable' ? 'unavailable' : 'pending'
      : 'ready',
    sides: hole.mode ? [hole.wolfSide, hole.opponents] : [], multiplier: hole.stake ?? 1, sourceGameId: game.id,
    ...(hole.mode === null && hole.reason ? { reason: hole.reason } : {}),
    ...Object.fromEntries((hole.contests ?? []).flatMap((contest) => contest.status === 'won' || contest.status === 'tied'
      ? [[contest.kind === 'high' ? 'highWinnerIds' : 'lowWinnerIds',
        contest.winner === 'wolf' ? hole.wolfSide : contest.winner === 'opponents' ? hole.opponents : []]] : [])),
  }));
  const awards: DotAward[] = holes.flatMap((hole) => (hole.contests ?? []).flatMap((contest) => {
    if (!contest.winner) return [];
    return [{ id: `${game.id}:${String(hole.number)}:${contest.kind}`, number: hole.number, kind: `wolf-${contest.kind}`,
      source: 'derived' as const, earnedBy: null, recipientIds: contest.winner === 'wolf' ? hole.wolfSide : hole.opponents,
      units: 1, count: 1, multiplier: hole.stake ?? 1, dots: hole.stake ?? 1, sourceHoles: [hole.number],
      scores: players.map((player) => {
        const score = cards.find((card) => card.playerId === player.playerId)?.holes.find((entry) => entry.number === hole.number)?.score;
        return { playerId: player.playerId, number: hole.number, strokes: score?.kind === 'strokes' ? score.strokes : null,
          par: player.layout.find((entry) => entry.number === hole.number)?.par ?? 0 };
      }), reason: `${contest.kind === 'high' ? 'High' : 'Low'} Wolf contest won.` }];
  }));
  if (game.highLowSweep) for (const hole of holes) {
    const contests = hole.contests ?? [];
    if (hole.mode !== 'partner' || contests.length !== 2 || !hole.winner
      || !contests.every((contest) => contest.status === 'won' && contest.winner === hole.winner)) continue;
    const evidence = awards.find((award) => award.number === hole.number)?.scores ?? [];
    awards.push({ id: `${game.id}:${String(hole.number)}:sweep`, number: hole.number, kind: 'wolf-sweep',
      source: 'derived', earnedBy: null, recipientIds: hole.winner === 'wolf' ? hole.wolfSide : hole.opponents,
      units: 1, count: 1, multiplier: 1, dots: 1, sourceHoles: [hole.number], scores: evidence,
      reason: 'The same partnered side won High and Low.' });
  }
  return { rulesVersion: 2, status, holes, contexts, awards, comeback,
    players: players.map((player) => {
      const entries = holes.flatMap((hole) => hole.transfers.filter((entry) => entry.playerId === player.playerId));
      const dots = entries.length ? entries.reduce((sum, entry) => sum + entry.dots, 0) : null;
      return { playerId: player.playerId, displayName: player.displayName, playingHandicap: handicaps.get(player.playerId) ?? null,
        holesScored: entries.length, totalHoles: layout.length, status, dotsWon: dots, dotsLost: 0, balance: dots };
    }) };
}
import { gameHandicap } from './game-handicaps.js';
