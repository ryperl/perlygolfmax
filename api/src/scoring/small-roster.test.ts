import { describe, expect, it, vi } from 'vitest';
import { isEventWorkspace } from '../../../src/contracts/setup.js';
import { isRoundScores } from '../../../src/contracts/scoring.js';
import { isEventLeaderboardView } from '../../../src/contracts/event-leaderboard.js';
import { isEventPurseView } from '../../../src/contracts/purse-settings.js';
import { stablefordPoints } from '../../../src/domain/stableford.js';
import type { TeamGameDefinition } from '../../../src/domain/games.js';
import { scoringFixture } from '../../test/scoring-fixtures.js';
import { identifier } from '../../test/catalog-fixtures.js';
import { creator, event } from '../../test/fixtures.js';
import { TablePurseStore } from '../purse/store.js';

describe('saved small-roster events', () => {
  it.each([1, 2, 3] as const)('reloads %i golfers through cards, individual results, overall standings and winnings', async (count) => {
    const f = await scoringFixture(count);
    const saved = await f.workspace.save(creator, event.id, {
      ...f.input, overallCompetition: { kind: 'stroke-play', basis: 'gross' },
    }, f.saved.etag);
    const reloaded = await f.workspace.get(creator, event.id);
    expect(isEventWorkspace(reloaded)).toBe(true);
    expect(reloaded.roster).toHaveLength(count);
    await expect(f.workspace.save(creator, event.id, { ...f.input, playerIds: [] }, saved.etag))
      .rejects.toMatchObject({ status: 400, code: 'INVALID_EVENT_SETUP' });
    await f.scores.saveGames(creator, event.id, f.roundId, [{
      id: identifier(700), name: 'Fictional small-field Stableford', preset: 'standard', basis: 'gross',
      handicapAllowancePercent: 95, points: stablefordPoints('standard'),
    }], null, identifier(800));
    await f.write();
    const cards = await f.scores.get(creator, event.id, f.roundId);
    expect(isRoundScores(cards)).toBe(true);
    expect(cards.cards).toHaveLength(count);
    expect(cards.games?.results[0]?.players).toHaveLength(count);
    expect(cards.games?.results[0]?.players[0]?.totalPoints).toBe(2);
    const charge = vi.fn().mockResolvedValue(undefined);
    const overall = await f.scores.leaderboard(creator, event.id, charge);
    expect(isEventLeaderboardView(overall)).toBe(true);
    expect(overall.standings.players).toHaveLength(count);
    const purse = new TablePurseStore(f.table, f.workspace, f.scores);
    await purse.save(creator, event.id, { eventId: event.id, currency: 'USD',
      funding: { kind: 'fixed', budgetMinor: 1000 }, pools: [{
        id: identifier(900), name: 'Fictional small-field prize', source: { kind: 'overall' },
        awardUnit: 'per-golfer', tiePolicy: 'pooled', prizes: [{ place: 1, amountMinor: 1000 }],
      }],
    }, [], null, identifier(901), charge);
    expect(isEventPurseView(await purse.get(creator, event.id, charge))).toBe(true);
  });

  it('accepts a complete two-player team, not a three-player roster assigned to that team', async () => {
    const team: TeamGameDefinition = {
      id: identifier(700), name: 'Fictional pair', preset: 'standard', basis: 'net',
      handicapAllowancePercent: 100, points: stablefordPoints('standard'), format: 'two-net-better-ball',
      teams: [{ id: identifier(710), name: 'Fictional team', playerIds: [identifier(200), identifier(201)] }],
    };
    const pair = await scoringFixture(2);
    const saved = await pair.scores.saveGames(creator, event.id, pair.roundId, [team], null, identifier(800));
    expect(isRoundScores(saved.round)).toBe(true);
    expect(saved.round.games?.results[0]?.teams).toHaveLength(1);
    const three = await scoringFixture(3);
    await expect(three.scores.saveGames(creator, event.id, three.roundId, [team], null, identifier(800)))
      .rejects.toMatchObject({ status: 400, code: 'INVALID_GAME_TEAMS' });
    const one = await scoringFixture(1);
    await expect(one.scores.saveGames(creator, event.id, one.roundId, [team], null, identifier(800)))
      .rejects.toMatchObject({ status: 400, code: 'INVALID_GAME_TEAMS' });
    const fourPlayerGame = { ...team, format: 'four-two-net', teams: [{
      ...team.teams[0], id: identifier(710), name: 'Fictional four-player team',
      playerIds: [200, 201, 202, 203].map(identifier),
    }] } as const;
    await expect(pair.scores.saveGames(creator, event.id, pair.roundId, [fourPlayerGame],
      saved.round.games?.configuration.etag ?? null, identifier(801)))
      .rejects.toMatchObject({ status: 400, code: 'INVALID_GAME_TEAMS' });
  });
});
