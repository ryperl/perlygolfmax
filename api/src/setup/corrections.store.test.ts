import { HttpRequest, InvocationContext } from '@azure/functions';
import { describe, expect, it, vi } from 'vitest';
import type { EventSetupInput } from '../../../src/domain/setup.js';
import type { TeamGameDefinition } from '../../../src/domain/games.js';
import { stablefordPoints } from '../../../src/domain/stableford.js';
import { calculateEventSkinsDetails } from '../../../src/domain/event-skins.js';
import { catalogFixture, identifier, manifest, tee } from '../../test/catalog-fixtures.js';
import { creator, event, member } from '../../test/fixtures.js';
import { TableScoreStore } from '../scoring/store.js';
import { TablePurseStore } from '../purse/store.js';
import { TablePublicEventStore } from '../public-access/store.js';
import { createPublicHandler } from '../public-access/handlers.js';

const alternateTee = {
  ...tee,
  id: 102,
  name: 'Fictional White',
};

async function correctionFixture() {
  const f = catalogFixture();
  f.seedEvent();
  const version = await f.publish(identifier(100), { ...manifest, teeProfileIds: [tee.id, alternateTee.id] }, [tee, alternateTee]);
  const players = await Promise.all([200, 201, 202, 203].map((id) =>
    f.players.create(creator, identifier(id), `Fictional Player ${String(id)}`)));
  const first = players[0];
  if (!first) throw new Error('Missing fictional first player');
  const initialObservation = await f.players.observe(creator, first.id, identifier(310), {
    value: '+1.2',
    effectiveDate: '2026-01-15',
    source: 'Fictional initial capture',
  }, first.etag);
  const ids = players.map((player) => player.id);
  const roundId = identifier(500);
  const input: EventSetupInput = {
    name: 'Fictional Correction Event',
    location: 'Fictional location',
    playerIds: ids,
    rounds: [{
      id: roundId,
      name: 'Fictional Round One',
      courseId: version.courseId,
      courseVersionId: version.id,
      teeProfileId: tee.id,
      groups: [{ number: 1, playerIds: ids }],
    }],
  };
  const empty = await f.workspace.get(creator, event.id);
  await f.workspace.save(creator, event.id, input, empty.etag);
  const scores = new TableScoreStore(f.table, f.workspace);
  const firstPlayerId = ids[0];
  if (!firstPlayerId) throw new Error('Missing fictional first player');
  await scores.write(creator, event.id, roundId, firstPlayerId, 1,
    { kind: 'strokes', strokes: 4 }, null, identifier(600));
  const teamGame: TeamGameDefinition = {
    id: identifier(700),
    name: 'Fictional Teams',
    preset: 'standard',
    basis: 'net',
    handicapAllowancePercent: 100,
    points: stablefordPoints('standard'),
    format: 'two-net-better-ball',
    teams: [
      { id: identifier(710), name: 'Fictional Team A', playerIds: ids.slice(0, 2) },
      { id: identifier(711), name: 'Fictional Team B', playerIds: ids.slice(2, 4) },
    ],
  };
  const games = await scores.saveGames(creator, event.id, roundId, [teamGame], null, identifier(601));
  return { ...f, ids, roundId, scores, initialObservation, games, teamGame };
}

describe('organizer round corrections', () => {
  it('applies HI/tee/group/team correction, keeps score cards unchanged and emits review warnings', async () => {
    const f = await correctionFixture();
    const before = await f.workspace.correctionModel(creator, event.id, f.roundId);
    const current = await f.scores.get(creator, event.id, f.roundId);
    const cardBefore = current.cards.find((card) => card.playerId === f.ids[0]);
    const revisedValue = '8.4';
    const corrected = await f.workspace.correctRound(creator, event.id, f.roundId, identifier(900), {
      expected: {
        eventEtag: before.eventEtag,
        roundEtag: before.roundEtag,
        gamesEtag: before.gamesEtag ?? null,
        inputRevision: before.inputRevision ?? null,
      },
      reason: 'Fictional organizer corrected captured inputs.',
      reviewSummary: 'Review KP and purse decisions.',
      correction: {
        teeProfileId: alternateTee.id,
        groups: [{ number: 1, playerIds: [...f.ids].reverse(), startingHole: 2 }],
        players: before.players.map((entry) => ({
          playerId: entry.playerId,
          handicapIndexValue: entry.playerId === f.ids[0] ? revisedValue : entry.handicapIndex?.value ?? null,
        })),
        gameTeams: [{
          gameId: f.teamGame.id,
          teams: [...f.teamGame.teams].reverse(),
        }],
      },
    });

    expect(corrected).toMatchObject({
      applied: true,
      receiptId: identifier(900),
      model: {
        eventId: event.id,
        roundId: f.roundId,
        teeProfileId: alternateTee.id,
        groups: [{ number: 1, startingHole: 2 }],
        gameTeams: [{ gameId: f.teamGame.id, teams: [...f.teamGame.teams].reverse() }],
      },
    });
    expect(corrected.model.inputRevision).toBe(identifier(900));
    const correctedPlayer = corrected.model.players.find((entry) => entry.playerId === f.ids[0])?.handicapIndex;
    expect(correctedPlayer?.value).toBe(revisedValue);
    expect(correctedPlayer?.id).not.toBe(f.initialObservation.currentIndex?.id);
    expect(correctedPlayer?.recordedBy).toEqual(creator);
    expect(correctedPlayer?.previousObservationId).toBe(f.initialObservation.currentIndex?.id ?? null);
    expect(correctedPlayer?.source).toContain('Organizer correction:');
    expect(correctedPlayer?.source).toContain('Fictional organizer corrected captured inputs.');
    const unchangedPlayer = corrected.model.players.find((entry) => entry.playerId === f.ids[1])?.handicapIndex;
    expect(unchangedPlayer).toBeNull();
    expect(corrected.model.warnings.map((warning) => warning.code)).toEqual(expect.arrayContaining([
      'kp-review-required',
      'team-review-required',
      'purse-review-required',
    ]));

    const after = await f.scores.get(creator, event.id, f.roundId);
    const cardAfter = after.cards.find((card) => card.playerId === f.ids[0]);
    expect(cardAfter?.holes[0]?.score).toEqual(cardBefore?.holes[0]?.score);
    expect((await f.scores.history(creator, event.id, f.roundId, f.ids[0] ?? '')).changes).toHaveLength(1);
    expect((await f.players.get(creator, f.ids[0] ?? '')).currentIndex).toEqual(f.initialObservation.currentIndex);
    expect(f.rows.get(`${event.id}|round-correction:${f.roundId}:${identifier(900)}`)).toBeDefined();
    expect(f.rows.get(`${event.id}|score-lock:${f.roundId}`)).toBeDefined();
  });

  it('allows event owner without catalog-management permission and rejects non-owners/public identities', async () => {
    const f = await correctionFixture();
    const model = await f.workspace.correctionModel(creator, event.id, f.roundId);
    f.seed({ partitionKey: event.id, rowKey: `member:${member.objectId}`, ...member, role: 'owner' });
    const byOwner = await f.workspace.correctRound(member, event.id, f.roundId, identifier(901), {
      expected: {
        eventEtag: model.eventEtag,
        roundEtag: model.roundEtag,
        gamesEtag: model.gamesEtag ?? null,
        inputRevision: model.inputRevision ?? null,
      },
      reason: 'Fictional owner correction.',
      correction: {
        teeProfileId: model.teeProfileId,
        groups: model.groups,
        players: model.players.map((entry) => ({ playerId: entry.playerId, handicapIndexValue: entry.handicapIndex?.value ?? null })),
      },
    });
    expect(byOwner.applied).toBe(false);

    await expect(f.workspace.correctionModel(member, event.id, identifier(999))).rejects.toMatchObject({ status: 404 });
    f.seed({ partitionKey: event.id, rowKey: `member:${member.objectId}`, ...member, role: 'member' });
    await expect(f.workspace.correctionModel(member, event.id, f.roundId)).rejects.toMatchObject({ status: 403, code: 'EVENT_MANAGEMENT_FORBIDDEN' });
    await expect(f.workspace.correctRound(member, event.id, f.roundId, identifier(902), {
      expected: {
        eventEtag: model.eventEtag,
        roundEtag: model.roundEtag,
        gamesEtag: model.gamesEtag ?? null,
        inputRevision: model.inputRevision ?? null,
      },
      reason: 'Fictional disallowed correction.',
      correction: {
        teeProfileId: model.teeProfileId,
        groups: model.groups,
        players: model.players.map((entry) => ({ playerId: entry.playerId, handicapIndexValue: entry.handicapIndex?.value ?? null })),
      },
    })).rejects.toMatchObject({ status: 403, code: 'EVENT_MANAGEMENT_FORBIDDEN' });
  });

  it('rejects fixed-roster/incompatible-tee changes and invalid Churchy grouping/order', async () => {
    const f = await correctionFixture();
    const ids = f.ids;
    const churchy = {
      id: identifier(720),
      name: 'Churchy Game',
      kind: 'churchy' as const,
      version: 1 as const,
      basis: 'net' as const,
      groupNumber: 1,
      playerIds: ids,
      currency: 'USD' as const,
      amountPerDotMinor: 100,
    };
    await f.scores.saveGames(
      creator,
      event.id,
      f.roundId,
      [f.teamGame, churchy],
      f.games.round.games?.configuration.etag ?? null,
      identifier(602),
    );
    const model = await f.workspace.correctionModel(creator, event.id, f.roundId);
    await expect(f.workspace.correctRound(creator, event.id, f.roundId, identifier(903), {
      expected: {
        eventEtag: model.eventEtag,
        roundEtag: model.roundEtag,
        gamesEtag: model.gamesEtag ?? null,
        inputRevision: model.inputRevision ?? null,
      },
      reason: 'Fictional incompatible tee.',
      correction: {
        teeProfileId: 999,
        groups: model.groups,
        players: model.players.map((entry) => ({ playerId: entry.playerId, handicapIndexValue: entry.handicapIndex?.value ?? null })),
      },
    })).rejects.toMatchObject({ status: 400, code: 'INCOMPATIBLE_TEE_PROFILE' });

    await expect(f.workspace.correctRound(creator, event.id, f.roundId, identifier(904), {
      expected: {
        eventEtag: model.eventEtag,
        roundEtag: model.roundEtag,
        gamesEtag: model.gamesEtag ?? null,
        inputRevision: model.inputRevision ?? null,
      },
      reason: 'Fictional roster edit.',
      correction: {
        teeProfileId: model.teeProfileId,
        groups: [{ number: 1, playerIds: ids.slice(0, 3) }],
        players: model.players.slice(0, 3).map((entry) => ({ playerId: entry.playerId, handicapIndexValue: entry.handicapIndex?.value ?? null })),
      },
    })).rejects.toMatchObject({ status: 400, code: 'ROUND_ROSTER_FIXED' });

    await expect(f.workspace.correctRound(creator, event.id, f.roundId, identifier(905), {
      expected: {
        eventEtag: model.eventEtag,
        roundEtag: model.roundEtag,
        gamesEtag: model.gamesEtag ?? null,
        inputRevision: model.inputRevision ?? null,
      },
      reason: 'Fictional changed Churchy order.',
      correction: {
        teeProfileId: model.teeProfileId,
        groups: [{ number: 1, playerIds: [ids[1] ?? '', ids[0] ?? '', ids[2] ?? '', ids[3] ?? ''] }],
        players: model.players.map((entry) => ({ playerId: entry.playerId, handicapIndexValue: entry.handicapIndex?.value ?? null })),
      },
    })).rejects.toMatchObject({ status: 409, code: 'CHURCHY_SETUP_CHANGED' });
  });

  it('uses conditional guards atomically, then supports replay after lost acknowledgement', async () => {
    const f = await correctionFixture();
    const model = await f.workspace.correctionModel(creator, event.id, f.roundId);

    await expect(f.workspace.correctRound(creator, event.id, f.roundId, identifier(906), {
      expected: {
        eventEtag: 'event-stale',
        roundEtag: model.roundEtag,
        gamesEtag: model.gamesEtag ?? null,
        inputRevision: model.inputRevision ?? null,
      },
      reason: 'Fictional stale event.',
      correction: {
        teeProfileId: model.teeProfileId,
        groups: model.groups,
        players: model.players.map((entry) => ({ playerId: entry.playerId, handicapIndexValue: entry.handicapIndex?.value ?? null })),
      },
    })).rejects.toMatchObject({ status: 409, code: 'EVENT_CHANGED' });

    const roundRowBefore = f.rows.get(`${event.id}|round:${f.roundId}`);
    const memberRow = f.rows.get(`${event.id}|member:${creator.objectId}`);
    if (!memberRow) throw new Error('Missing fictional member row.');
    f.submit.mockImplementationOnce((actions) => {
      f.rows.set(`${event.id}|member:${creator.objectId}`, { ...memberRow, revised: true, etag: 'revision-race' });
      try {
        f.apply(actions);
      } catch (error) {
        return Promise.reject(error instanceof Error ? error : new Error('Invalid fictional correction race'));
      }
      return Promise.resolve({ status: 202, subResponses: [], getResponseForEntity: () => undefined });
    });
    await expect(f.workspace.correctRound(creator, event.id, f.roundId, identifier(907), {
      expected: {
        eventEtag: model.eventEtag,
        roundEtag: model.roundEtag,
        gamesEtag: model.gamesEtag ?? null,
        inputRevision: model.inputRevision ?? null,
      },
      reason: 'Fictional race test.',
      correction: {
        teeProfileId: model.teeProfileId,
        groups: model.groups.map((group) => ({ ...group, startingHole: 2 })),
        players: model.players.map((entry) => ({ playerId: entry.playerId, handicapIndexValue: entry.handicapIndex?.value ?? null })),
      },
    })).rejects.toMatchObject({ status: 409, code: 'ROUND_CORRECTION_CONFLICT' });
    expect(f.rows.get(`${event.id}|round:${f.roundId}`)).toEqual(roundRowBefore);
    expect(f.rows.has(`${event.id}|round-correction:${f.roundId}:${identifier(907)}`)).toBe(false);

    f.submit.mockImplementationOnce((actions) => {
      f.apply(actions);
      return Promise.reject(new Error('Fictional lost correction acknowledgement'));
    });
    await expect(f.workspace.correctRound(creator, event.id, f.roundId, identifier(908), {
      expected: {
        eventEtag: model.eventEtag,
        roundEtag: model.roundEtag,
        gamesEtag: model.gamesEtag ?? null,
        inputRevision: model.inputRevision ?? null,
      },
      reason: 'Fictional correction replay.',
      correction: {
        teeProfileId: model.teeProfileId,
        groups: model.groups.map((group) => ({ ...group, startingHole: 2 })),
        players: model.players.map((entry) => ({ playerId: entry.playerId, handicapIndexValue: entry.handicapIndex?.value ?? null })),
      },
    })).rejects.toThrow('Fictional lost correction acknowledgement');

    const replay = await f.workspace.correctRound(creator, event.id, f.roundId, identifier(908), {
      expected: {
        eventEtag: model.eventEtag,
        roundEtag: model.roundEtag,
        gamesEtag: model.gamesEtag ?? null,
        inputRevision: model.inputRevision ?? null,
      },
      reason: 'Fictional correction replay.',
      correction: {
        teeProfileId: model.teeProfileId,
        groups: model.groups.map((group) => ({ ...group, startingHole: 2 })),
        players: model.players.map((entry) => ({ playerId: entry.playerId, handicapIndexValue: entry.handicapIndex?.value ?? null })),
      },
    });
    expect(replay).toMatchObject({ applied: false, receiptId: identifier(908), model: { inputRevision: identifier(908) } });

    await expect(f.workspace.correctRound(creator, event.id, f.roundId, identifier(908), {
      expected: {
        eventEtag: model.eventEtag,
        roundEtag: model.roundEtag,
        gamesEtag: model.gamesEtag ?? null,
        inputRevision: model.inputRevision ?? null,
      },
      reason: 'Fictional conflicting replay.',
      correction: {
        teeProfileId: model.teeProfileId,
        groups: model.groups,
        players: model.players.map((entry) => ({ playerId: entry.playerId, handicapIndexValue: entry.handicapIndex?.value ?? null })),
      },
    })).rejects.toMatchObject({ status: 409, code: 'ROUND_CORRECTION_REQUEST_CONFLICT' });
  });

  it('recomputes canonical game/overall/event-skins/purse reads after correction while raw scores and capture receipts stay intact', async () => {
    const f = catalogFixture();
    f.seedEvent();
    const version = await f.publish(identifier(120), { ...manifest, teeProfileIds: [tee.id, alternateTee.id] }, [tee, alternateTee]);
    const players = await Promise.all([220, 221, 222, 223].map((id) =>
      f.players.create(creator, identifier(id), `Fictional Recalc Player ${String(id)}`)));
    for (const [index, player] of players.entries()) {
      await f.players.observe(creator, player.id, identifier(4500 + index), {
        value: '10.0',
        effectiveDate: '2026-01-01',
        source: 'Fictional captured index',
      }, player.etag);
    }
    const ids = players.map((player) => player.id);
    const roundId = identifier(520);
    const input: EventSetupInput = {
      name: 'Fictional Recalc Event',
      location: 'Fictional course',
      playerIds: ids,
      overallCompetition: { kind: 'stroke-play', basis: 'net', handicapAllowancePercent: 95 },
      rounds: [{
        id: roundId,
        name: 'Fictional Recalc Round',
        courseId: version.courseId,
        courseVersionId: version.id,
        teeProfileId: tee.id,
        groups: [{ number: 1, playerIds: ids }],
      }],
    };
    const empty = await f.workspace.get(creator, event.id);
    await f.workspace.save(creator, event.id, input, empty.etag);
    const scores = new TableScoreStore(f.table, f.workspace);
    const purse = new TablePurseStore(f.table, f.workspace, scores);
    const gameId = identifier(5300);
    await scores.saveGames(creator, event.id, roundId, [{
      id: gameId,
      name: 'Fictional net game',
      preset: 'standard',
      basis: 'net',
      handicapAllowancePercent: 95,
      points: stablefordPoints('standard'),
    }], null, identifier(5301));
    const configured = await f.workspace.get(creator, event.id);
    await scores.saveEventSkins(creator, event.id, { version: 1 }, configured.etag, identifier(5302));
    for (const [index, playerId] of ids.entries()) {
      await scores.write(creator, event.id, roundId, playerId, 1, { kind: 'strokes', strokes: 3 }, null, identifier(5310 + index));
    }
    await purse.save(creator, event.id, {
      eventId: event.id,
      currency: 'USD',
      funding: { kind: 'fixed', budgetMinor: 9000 },
      pools: [
        { id: identifier(5400), name: 'Fictional overall', source: { kind: 'overall' }, awardUnit: 'per-golfer',
          tiePolicy: 'pooled', prizes: [{ place: 1, amountMinor: 3000 }] },
        { id: identifier(5401), name: 'Fictional game', source: { kind: 'round-game', roundId, gameId }, awardUnit: 'per-golfer',
          tiePolicy: 'pooled', prizes: [{ place: 1, amountMinor: 3000 }] },
        { id: identifier(5402), name: 'Fictional event skins', source: { kind: 'event-skins', version: 1 }, awardUnit: 'pot', amountMinor: 3000 },
      ],
    }, [], null, identifier(5403), vi.fn().mockResolvedValue(undefined));

    const charge = vi.fn().mockResolvedValue(undefined);
    const beforeRound = await scores.get(creator, event.id, roundId);
    const beforeCards = JSON.stringify(beforeRound.cards);
    const beforeCapture = f.rows.get(`${event.id}|index-capture:${roundId}`);
    const beforeLeaderboard = await scores.leaderboard(creator, event.id, charge);
    const beforeSkins = calculateEventSkinsDetails(beforeLeaderboard.workspace, beforeLeaderboard.roundScores);
    const beforePurse = await purse.get(creator, event.id, charge);
    const beforeGamePlayers = beforeRound.games?.results[0]?.players;
    const beforeStandings = JSON.stringify(beforeLeaderboard.standings);
    const beforeSkinsWinner = beforeSkins.holes.find((hole) => hole.roundId === roundId && hole.number === 1)?.winnerId ?? null;
    const beforePursePlayers = JSON.stringify(beforePurse.view?.calculation.players ?? []);

    const model = await f.workspace.correctionModel(creator, event.id, roundId);
    const corrected = await f.workspace.correctRound(creator, event.id, roundId, identifier(5500), {
      expected: {
        eventEtag: model.eventEtag,
        roundEtag: model.roundEtag,
        gamesEtag: model.gamesEtag ?? null,
        inputRevision: model.inputRevision ?? null,
      },
      reason: 'Fictional organizer correction for recalc.',
      correction: {
        teeProfileId: alternateTee.id,
        groups: model.groups,
        players: model.players.map((entry) => ({
          playerId: entry.playerId,
          handicapIndexValue: entry.playerId === ids[0] ? '20.0' : entry.handicapIndex?.value ?? null,
        })),
      },
    });
    expect(corrected.applied).toBe(true);
    expect(corrected.model.warnings.map((warning) => warning.code)).toContain('kp-review-required');
    expect(corrected.model.warnings.map((warning) => warning.code)).toContain('purse-review-required');

    const afterRound = await scores.get(creator, event.id, roundId);
    const afterLeaderboard = await scores.leaderboard(creator, event.id, charge);
    const afterSkins = calculateEventSkinsDetails(afterLeaderboard.workspace, afterLeaderboard.roundScores);
    const afterPurse = await purse.get(creator, event.id, charge);
    const afterGamePlayers = afterRound.games?.results[0]?.players;
    const afterStandings = JSON.stringify(afterLeaderboard.standings);
    const afterSkinsWinner = afterSkins.holes.find((hole) => hole.roundId === roundId && hole.number === 1)?.winnerId ?? null;
    const afterPursePlayers = JSON.stringify(afterPurse.view?.calculation.players ?? []);

    expect(JSON.stringify(afterRound.cards)).toBe(beforeCards);
    expect(f.rows.get(`${event.id}|index-capture:${roundId}`)).toEqual(beforeCapture);
    expect(JSON.stringify(afterGamePlayers)).not.toBe(JSON.stringify(beforeGamePlayers));
    expect(afterStandings).not.toBe(beforeStandings);
    expect(afterSkinsWinner).not.toBe(beforeSkinsWinner);
    expect(afterPursePlayers).not.toBe(beforePursePlayers);

    const api = {
      verify: vi.fn().mockRejectedValue(new Error('unused')),
      publicEvents: new TablePublicEventStore(f.table),
      workspace: f.workspace,
      scores,
      purse,
      limiter: { check: vi.fn().mockResolvedValue(undefined) },
    };
    const context = new InvocationContext({ invocationId: 'fictional-public-correction-proof', logHandler: () => undefined });
    const firstPlayerId = ids[0];
    if (!firstPlayerId) throw new Error('Missing first player');
    const card = afterRound.cards.find((entry) => entry.playerId === firstPlayerId);
    if (!card?.etag) throw new Error('Missing corrected card etag');
    const cardEtag = card.etag;
    const publicRequest = (body: unknown) => new HttpRequest({
      url: `https://fictional.example.test/api/public/events/${event.id}/rounds/${roundId}/players/${firstPlayerId}/holes/1`,
      method: 'PUT',
      params: { id: event.id, roundId, playerId: firstPlayerId, holeNumber: '1' },
      headers: { 'If-Match': cardEtag, 'Idempotency-Key': identifier(5600), 'Content-Type': 'application/json' },
      body: { string: JSON.stringify(body) },
    });
    const callPublic = (body: unknown) => createPublicHandler(() => api, 'score-hole')(publicRequest(body), context);
    expect(await callPublic({ score: { kind: 'strokes', strokes: 4 } })).toMatchObject({ status: 409, jsonBody: { code: 'SCORE_INPUTS_CHANGED' } });
    expect(await callPublic({ score: { kind: 'strokes', strokes: 4 }, inputRevision: identifier(9999) }))
      .toMatchObject({ status: 409, jsonBody: { code: 'SCORE_INPUTS_CHANGED' } });
    expect(await callPublic({ score: { kind: 'strokes', strokes: 4 }, inputRevision: corrected.model.inputRevision }))
      .toMatchObject({ status: 200 });
  });
});
