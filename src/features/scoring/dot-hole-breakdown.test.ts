import { describe, expect, it } from 'vitest';
import { calculateGameResults } from '../../domain/stableford';
import { matchGamesFixture } from '../../domain/match-games.test-support';
import { churchyFixture } from '../../domain/churchy.test-support';
import { churchyV3Fixture } from '../../domain/churchy-v3.test-support';
import type { DotsGameDefinition } from '../../domain/dots';
import { dotHoleBreakdown } from './dot-hole-breakdown';

describe('saved per-hole dot breakdown', () => {
  it('separates earned Wolf base from explicitly linked Dots and attributes shared source awards', () => {
    const f = matchGamesFixture();
    const a = f.ids[0], b = f.ids[1];
    if (!a || !b) throw new Error('Missing fictional players');
    const wolf = { ...f.wolf, version: 2 as const, stakeMinor: null };
    const dots: DotsGameDefinition = { id: f.nassau.id, name: 'Fictional Dots', kind: 'dots', version: 1,
      mode: 'linked', linkedGameId: wolf.id, groupNumber: 1, playerIds: f.ids, specials: [{ kind: 'sandy', units: 1 }] };
    const cards = f.cards.map((card, index) => ({ ...card, holes: card.holes.map((hole) => ({ ...hole,
      score: { kind: 'strokes' as const, strokes: index < 2 ? 3 : 4, ...(card.playerId === a && hole.number === 1 ? {
        wolf: [{ number: 1, choice: { gameId: wolf.id, gameEtag: 'fictional-game-revision', mode: 'partner' as const, partnerId: b } }],
        dots: [{ number: 1, gameId: dots.id, gameEtag: 'fictional-game-revision', contests: [],
          players: [{ playerId: a, counts: { sandy: 2 }, calls: [] }] }],
      } : {}) },
    })) }));
    const round = f.round(cards, [wolf, dots]);
    const selected = { definition: dots, result: round.games?.results.find((entry) => entry.gameId === dots.id) };
    const detail = dotHoleBreakdown(selected, b, 1, cards, round);
    expect(detail).toMatchObject({ status: 'complete', base: 2, specials: 2, total: 4 });
    expect(detail.entries).toContainEqual({ label: 'Sandy', dots: 2, source: cards[0]?.displayName, lane: 'specials' });
    const standalone: DotsGameDefinition = { id: dots.id, name: dots.name, kind: 'dots', version: 1, mode: 'individual',
      groupNumber: 1, playerIds: f.ids, specials: dots.specials, stakeMinor: null };
    const result = calculateGameResults([standalone], f.snapshot, cards)[0];
    expect(dotHoleBreakdown({ definition: standalone, result }, a, 1, cards)).toMatchObject({ base: 0, specials: 2, total: 2 });
    expect(dotHoleBreakdown(selected, b, 1, cards)).toMatchObject({ status: 'unavailable', total: null });
  });

  it.each([1, 2, 3] as const)('supports Churchie v%i without exposing private audit identity', (version) => {
    const f = churchyFixture();
    const modern = churchyV3Fixture(18, 1, 'tee');
    const game = version === 3 ? modern.game : version === 2 ? { ...f.game, version: 2 as const,
      enabledSpecials: ['sandy', 'birdie', 'sweep'] as const } : f.game;
    const snapshot = version === 3 ? modern.snapshot : f.snapshot;
    const cards = version === 3 ? modern.cards : f.cards;
    const result = calculateGameResults([game], snapshot, cards)[0];
    const id = game.playerIds[0];
    if (!id) throw new Error('Missing fictional golfer');
    const detail = dotHoleBreakdown({ definition: game, result }, id, 1, cards);
    expect(detail.status).toBe('complete');
    expect(detail.base).not.toBeNull();
    expect(detail.specials).not.toBeNull();
    expect(detail.total).toBe((detail.base ?? 0) + (detail.specials ?? 0));
    expect(JSON.stringify(detail)).not.toMatch(/recordedBy|tenantId|objectId|gameEtag/);
  });

  it('preserves legacy signed Wolf transfers, known zero and pending or missing results', () => {
    const f = matchGamesFixture();
    const a = f.ids[0], b = f.ids[1];
    if (!a || !b) throw new Error('Missing fictional players');
    const cards = f.cards.map((card) => ({ ...card, holes: card.holes.map((hole) => ({ ...hole,
      score: { ...hole.score, ...(card.playerId === a && hole.number === 1 ? { wolf: [{
        number: 1, choice: { gameId: f.wolf.id, gameEtag: 'fictional-game-revision', mode: 'partner' as const, partnerId: b },
        outcome: 'opponents' as const,
      }] } : {}) },
    })) }));
    const round = f.round(cards, [f.wolf]);
    const game = { definition: f.wolf, result: round.games?.results[0] };
    expect(dotHoleBreakdown(game, a, 1, cards)).toMatchObject({ base: -2, specials: 0, total: -2 });
    expect(dotHoleBreakdown(game, a, 2, cards)).toMatchObject({ status: 'pending', base: null, total: null });
    expect(dotHoleBreakdown({ definition: f.wolf, result: undefined }, a, 1, cards)).toMatchObject({ status: 'unavailable', total: null });
  });

  it.each(['blind', 'pig'] as const)('names %s Wolf awards and refuses mismatched saved totals', (mode) => {
    const f = matchGamesFixture(), a = f.ids[0];
    if (!a) throw new Error('Missing fictional golfer');
    const wolf = { ...f.wolf, version: 2 as const, stakeMinor: null, allowPig: true };
    const cards = f.cards.map((card, index) => ({ ...card, holes: card.holes.map((hole) => ({ ...hole,
      score: { kind: 'strokes' as const, strokes: index === 0 ? 3 : 5,
        ...(card.playerId === a && hole.number === 1 ? { wolf: [{
          number: 1, choice: { gameId: wolf.id, gameEtag: 'fictional-game-revision', mode },
        }] } : {}),
      },
    })) }));
    const result = calculateGameResults([wolf], f.snapshot, cards)[0];
    if (!result?.wolf) throw new Error('Missing fictional Wolf results');
    const detail = dotHoleBreakdown({ definition: wolf, result }, a, 1, cards);
    expect(detail).toMatchObject({ status: 'complete', base: mode === 'pig' ? 3 : 2, specials: 0 });
    expect(detail.entries.map((entry) => entry.label)).toEqual([mode === 'pig' ? 'PIG' : 'Blind Wolf']);
    const inconsistent = { ...result, wolf: { ...result.wolf, holes: result.wolf.holes.map((hole) => ({
      ...hole, transfers: hole.transfers.map((entry) => ({ ...entry, dots: entry.dots + 1 })),
    })) } };
    expect(dotHoleBreakdown({ definition: wolf, result: inconsistent }, a, 1, cards))
      .toMatchObject({ status: 'unavailable', base: null, specials: null, total: null });
  });
});
