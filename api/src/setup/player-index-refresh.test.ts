import { describe, expect, it, vi } from 'vitest';
import { catalogFixture, identifier, manifest, tee } from '../../test/catalog-fixtures.js';
import { creator, event, member } from '../../test/fixtures.js';
import { TableScoreStore } from '../scoring/store.js';
import { privateContent } from '../private-values.js';
import { canonical } from '../catalog/entities.js';
import type { RoundSnapshot } from '../../../src/domain/setup.js';
import { isRecord } from '../../../src/contracts/events.js';
import { isEventHandicapRefreshResult } from '../../../src/contracts/player-handicap-update.js';
import { stablefordPoints } from '../../../src/domain/stableford.js';
import { scoringFixture } from '../../test/scoring-fixtures.js';
import type { RoundGameDefinition } from '../../../src/domain/games.js';
import type { HoleScore } from '../../../src/domain/scoring.js';
import { defaultChurchySpecialSelections } from '../../../src/domain/churchy.js';
import { isRoundCorrectionReceipt } from '../../../src/contracts/round-corrections.js';
import { TableWorkspaceStore } from './store.js';
import { ApiError } from '../errors.js';

async function fixture(initialValue: string | null = '+1.2') {
  const f = catalogFixture();
  f.seedEvent();
  const alternateTee = { ...tee, id: 102, name: 'Fictional personal tee',
    ratings: tee.ratings.map((rating) => ({ ...rating, slope: 113 })) };
  const version = await f.publish(identifier(100), { ...manifest, teeProfileIds: [tee.id, alternateTee.id] }, [tee, alternateTee]);
  const players = await Promise.all([200, 201, 202, 203].map((number) =>
    f.players.create(creator, identifier(number), `Fictional Player ${String(number)}`)));
  const first = players[0];
  if (!first) throw new Error('Missing fictional player');
  if (initialValue !== null) await f.players.observe(creator, first.id, identifier(300), {
    value: initialValue, effectiveDate: '2026-01-15', source: 'Fictional initial input',
  }, first.etag);
  const playerIds = players.map((player) => player.id);
  const roundIds = [500, 501, 502].map(identifier);
  const empty = await f.workspace.get(creator, event.id);
  await f.workspace.save(creator, event.id, {
    name: 'Fictional Handicap Refresh', location: '', playerIds, allowPerGolferTees: true,
    rounds: roundIds.map((id) => ({ id, name: `Fictional Round ${id.slice(-1)}`, courseId: version.courseId,
      courseVersionId: version.id, teeProfileId: tee.id, groups: [{ number: 1, playerIds }],
      playerTeeSelections: [{ playerId: first.id, teeProfileId: alternateTee.id }] })),
  }, empty.etag);
  const scores = new TableScoreStore(f.table, f.workspace);
  const unfinished = roundIds[0] ?? '';
  const completed = roundIds[1] ?? '';
  const unstarted = roundIds[2] ?? '';
  await scores.write(creator, event.id, unfinished, first.id, 1, { kind: 'strokes', strokes: 4 }, null, identifier(600));
  for (const [index, playerId] of playerIds.entries()) {
    await scores.write(creator, event.id, completed, playerId, 1, { kind: 'strokes', strokes: 4 }, null, identifier(610 + index));
    const key = `score-card:${completed}:${playerId}`;
    const stored = JSON.parse(await privateContent(f.table, event.id, key, f.rows.get(`${event.id}|${key}`)?.content)) as unknown;
    if (!isRecord(stored)) throw new Error('Invalid fictional card');
    f.seed({ partitionKey: event.id, rowKey: key, content: canonical({ ...stored,
      holes: tee.holes.map((hole) => ({ number: hole.number, score: index === 1 ? { kind: 'picked-up', reportedStrokes: 7 }
        : index === 2 ? { kind: 'did-not-finish' } : { kind: 'strokes', strokes: 4 } })) }) });
  }
  const observe = async (value: string, operation = 800) => {
    const profile = await f.players.get(creator, first.id);
    const updated = await f.players.observe(creator, first.id, identifier(operation), {
      value, effectiveDate: '2026-02-01', source: 'Fictional manual GHIN',
    }, profile.etag);
    if (!updated.currentIndex) throw new Error('Missing fictional observation');
    return updated.currentIndex;
  };
  const refresh = async (observationId: string, requestId = identifier(900), expected = f.rows.get(`${event.id}|event`)?.etag ?? '') =>
    f.workspace.refreshPlayerIndex(creator, event.id, first.id, observationId, expected, requestId);
  const finishUnfinished = async (exceptLast = false) => {
    const workspace = await f.workspace.getForScoring(creator, event.id);
    const revision = workspace.rounds.find((round) => round.id === unfinished)?.inputRevision;
    for (const [index, playerId] of playerIds.entries()) {
      const key = `score-card:${unfinished}:${playerId}`;
      if (!f.rows.has(`${event.id}|${key}`)) {
        await scores.write(creator, event.id, unfinished, playerId, 1, { kind: 'strokes', strokes: 4 },
          null, identifier(650 + index), revision);
      }
      const stored: unknown = JSON.parse(await privateContent(f.table, event.id, key, f.rows.get(`${event.id}|${key}`)?.content));
      if (!isRecord(stored)) throw new Error('Invalid fictional card');
      f.seed({ partitionKey: event.id, rowKey: key, content: canonical({ ...stored,
        holes: tee.holes.map((hole) => ({ number: hole.number, score: exceptLast && playerId === first.id && hole.number === 18
          ? { kind: 'unplayed' } : { kind: 'strokes', strokes: 4 } })) }) });
    }
  };
  return { ...f, scores, first, playerIds, unfinished, completed, unstarted, observe, refresh, finishUnfinished };
}

describe('catalog-manager scoped event player Handicap Index refresh', () => {
  it('updates only unfinished captured inputs using personal tees, recomputes net, and preserves raw/capture/lock data', async () => {
    const f = await fixture();
    await f.scores.saveGames(creator, event.id, f.unfinished, [{
      id: identifier(700), name: 'Fictional Net Stableford', basis: 'net',
      handicapAllowancePercent: 100, preset: 'standard', points: stablefordPoints('standard'),
    }], null, identifier(701));
    const before = await f.scores.get(creator, event.id, f.unfinished);
    const beforeWorkspace = await f.workspace.getForScoring(creator, event.id);
    const beforeRound = beforeWorkspace.rounds.find((round) => round.id === f.unfinished);
    const untouched = new Map([...f.rows].filter(([key]) => key.startsWith(`${event.id}|score-`)
      || key.startsWith(`${event.id}|index-capture:`) || key === `${event.id}|round:${f.completed}`
      || key === `${event.id}|round:${f.unstarted}`));
    const current = await f.observe('18');
    const charge = vi.fn().mockResolvedValue(undefined);
    const expected = f.rows.get(`${event.id}|event`)?.etag ?? '';
    const result = await f.workspace.refreshPlayerIndex(creator, event.id, f.first.id, current.id, expected, identifier(900), charge);
    expect(result).toMatchObject({ eventId: event.id, playerId: f.first.id,
      updatedRoundIds: [f.unfinished], completedRoundIds: [f.completed] });
    expect(result.etag).not.toBe(expected);
    expect(isEventHandicapRefreshResult(result)).toBe(true);
    expect(charge).toHaveBeenCalledTimes(3);
    for (const [key, row] of untouched) expect(f.rows.get(key), key).toEqual(row);
    const afterWorkspace = await f.workspace.getForScoring(creator, event.id);
    const afterRound = afterWorkspace.rounds.find((round) => round.id === f.unfinished);
    expect(afterRound?.players[0]?.handicapIndex).toEqual(current);
    expect(afterRound?.players.slice(1)).toEqual(beforeRound?.players.slice(1));
    expect(afterRound).toMatchObject({ inputRevision: identifier(900),
      course: beforeRound?.course, teeProfile: beforeRound?.teeProfile, playerTees: beforeRound?.playerTees,
      groups: beforeRound?.groups, reviewWarnings: [expect.objectContaining({ code: 'purse-review-required' })] });
    const after = await f.scores.get(creator, event.id, f.unfinished);
    expect(before.courseHandicaps?.find((entry) => entry.playerId === f.first.id)?.courseHandicap).toBe(-1);
    expect(after.courseHandicaps?.find((entry) => entry.playerId === f.first.id)?.courseHandicap).toBe(18);
    expect(after.cards).toEqual(before.cards);
    expect(before.games?.results[0]?.players.find((entry) => entry.playerId === f.first.id)?.holes[0]?.points).toBe(2);
    expect(after.games?.results[0]?.players.find((entry) => entry.playerId === f.first.id)?.holes[0]?.points).toBe(3);
    const gross = after.cards.find((card) => card.playerId === f.first.id)?.holes[0]?.score;
    expect(gross).toEqual({ kind: 'strokes', strokes: 4 });
    expect(JSON.stringify(await f.scores.get({ kind: 'public-score', eventId: event.id }, event.id, f.unfinished)))
      .not.toContain('Fictional manual GHIN');
    const key = `player-index-refresh:${identifier(900)}`;
    expect(JSON.parse(await privateContent(f.table, event.id, key, f.rows.get(`${event.id}|${key}`)?.content)))
      .toMatchObject({ observationId: current.id, recordedBy: creator, corrections: [
        { roundId: f.unfinished, before: { players: [{ handicapIndexValue: '+1.2' }, ...f.playerIds.slice(1).map(() => ({ handicapIndexValue: null }))] },
          after: { players: [{ handicapIndexValue: '18' }, ...f.playerIds.slice(1).map(() => ({ handicapIndexValue: null }))] } },
      ] });
  });

  it.each(['0', '+2.3', '9.4'])('adopts acknowledged %s from an NH capture without changing other NH inputs', async (value) => {
    const f = await fixture(null);
    const current = await f.observe(value);
    await f.refresh(current.id);
    const round = (await f.workspace.getForScoring(creator, event.id)).rounds.find((entry) => entry.id === f.unfinished);
    expect(round?.players[0]?.handicapIndex).toEqual(current);
    expect(round?.players.slice(1).every((entry) => entry.handicapIndex === null)).toBe(true);
  });

  it('allows a manager with no owner grant on a ready Quick round, without creating any membership', async () => {
    const f = await fixture();
    const current = await f.observe('12');
    f.rows.delete(`${event.id}|member:${creator.objectId}`);
    f.seed({ ...f.rows.get(`${event.id}|event`), partitionKey: event.id, rowKey: 'event', quickRound: true, quickRoundReady: true });
    expect((await f.refresh(current.id)).updatedRoundIds).toEqual([f.unfinished]);
    expect(f.rows.has(`${event.id}|member:${creator.objectId}`)).toBe(false);
    f.seed({ ...f.rows.get(`${event.id}|event`), partitionKey: event.id, rowKey: 'event', quickRoundReady: false });
    await expect(f.refresh(current.id, identifier(901))).rejects.toMatchObject({ status: 403 });
    f.seed({ ...f.rows.get(`${event.id}|event`), partitionKey: event.id, rowKey: 'event', quickRoundReady: true, status: 'archived' });
    await expect(f.refresh(current.id, identifier(901))).rejects.toMatchObject({ status: 404 });
  });

  it('updates all eligible event rounds in one transaction, or none if a later round races', async () => {
    const f = await fixture();
    await f.scores.write(creator, event.id, f.unstarted, f.first.id, 1, { kind: 'strokes', strokes: 4 }, null, identifier(660));
    const current = await f.observe('12');
    const before = f.rows.get(`${event.id}|round:${f.unfinished}`);
    f.submit.mockImplementationOnce((actions) => {
      f.seed({ ...f.rows.get(`${event.id}|round:${f.unstarted}`), partitionKey: event.id, rowKey: `round:${f.unstarted}` });
      f.apply(actions);
      return Promise.resolve({ status: 202, subResponses: [], getResponseForEntity: () => undefined });
    });
    await expect(f.refresh(current.id)).rejects.toMatchObject({ code: 'EVENT_CHANGED' });
    expect(f.rows.get(`${event.id}|round:${f.unfinished}`)).toEqual(before);
    expect(f.rows.has(`${event.id}|player-index-refresh:${identifier(900)}`)).toBe(false);
    expect((await f.refresh(current.id)).updatedRoundIds).toEqual([f.unfinished, f.unstarted]);
  });

  it('denies a non-manager owner, mismatched observations, non-roster players and stale revisions', async () => {
    const f = await fixture();
    const current = await f.observe('12');
    f.seed({ partitionKey: event.id, rowKey: `member:${member.objectId}`, ...member, role: 'owner' });
    const expected = f.rows.get(`${event.id}|event`)?.etag ?? '';
    await expect(f.workspace.refreshPlayerIndex(member, event.id, f.first.id, current.id, expected, identifier(900)))
      .rejects.toMatchObject({ status: 403 });
    await expect(f.refresh(identifier(999))).rejects.toMatchObject({ code: 'PLAYER_INDEX_CHANGED' });
    await expect(f.refresh(current.id, identifier(900), 'stale-revision')).rejects.toMatchObject({ code: 'EVENT_CHANGED' });
    await expect(f.workspace.refreshPlayerIndex(creator, event.id, identifier(999), current.id, expected, identifier(900)))
      .rejects.toMatchObject({ code: 'PLAYER_NOT_IN_EVENT' });
    expect(f.rows.has(`${event.id}|player-index-refresh:${identifier(900)}`)).toBe(false);
  });

  it('rechecks manager authority before publication and aborts on a per-round quota failure', async () => {
    const f = await fixture();
    const current = await f.observe('12');
    let allowed = true;
    const store = new TableWorkspaceStore(f.table, f.courses, f.players, () => allowed);
    const expected = f.rows.get(`${event.id}|event`)?.etag ?? '';
    const before = f.rows.get(`${event.id}|round:${f.unfinished}`);
    await expect(store.refreshPlayerIndex(creator, event.id, f.first.id, current.id, expected, identifier(900),
      () => { allowed = false; return Promise.resolve(); })).rejects.toMatchObject({ status: 403 });
    expect(f.rows.get(`${event.id}|round:${f.unfinished}`)).toEqual(before);
    const quota = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new ApiError(429, 'REQUEST_LIMIT_EXCEEDED'));
    await expect(f.workspace.refreshPlayerIndex(creator, event.id, f.first.id, current.id, expected, identifier(900), quota))
      .rejects.toMatchObject({ status: 429 });
    expect(f.rows.get(`${event.id}|round:${f.unfinished}`)).toEqual(before);
    expect(f.rows.has(`${event.id}|player-index-refresh:${identifier(900)}`)).toBe(false);
  });

  it('replays its original acknowledgement after later completion/catalog changes and rejects altered operation reuse', async () => {
    const f = await fixture();
    const current = await f.observe('12');
    const expected = f.rows.get(`${event.id}|event`)?.etag ?? '';
    const result = await f.refresh(current.id, identifier(900), expected);
    const roundRow = f.rows.get(`${event.id}|round:${f.unfinished}`);
    await f.finishUnfinished();
    await f.observe('14', 801);
    f.seed({ ...f.rows.get(`${event.id}|event`), partitionKey: event.id, rowKey: 'event', scoresUpdatedAt: '2026-03-01T00:00:00Z' });
    expect(await f.refresh(current.id, identifier(900), expected)).toEqual(result);
    expect(f.rows.get(`${event.id}|round:${f.unfinished}`)).toEqual(roundRow);
    await expect(f.refresh(identifier(801), identifier(900), expected)).rejects.toMatchObject({ code: 'PLAYER_INDEX_REFRESH_REQUEST_CONFLICT' });
    await expect(f.refresh(current.id, identifier(900))).rejects.toMatchObject({ code: 'PLAYER_INDEX_REFRESH_REQUEST_CONFLICT' });
    const anotherManager = new TableWorkspaceStore(f.table, f.courses, f.players, () => true);
    await expect(anotherManager.refreshPlayerIndex(member, event.id, f.first.id, current.id, expected, identifier(900)))
      .rejects.toMatchObject({ code: 'PLAYER_INDEX_REFRESH_REQUEST_CONFLICT' });
  });

  it('recovers a committed mutation after a lost response and refuses old public score input revisions', async () => {
    const f = await fixture();
    const current = await f.observe('12');
    const expected = f.rows.get(`${event.id}|event`)?.etag ?? '';
    f.submit.mockImplementationOnce((actions) => {
      f.apply(actions);
      return Promise.reject(new Error('Fictional lost mutation response'));
    });
    f.submit.mockImplementationOnce((actions) => {
      f.apply(actions);
      return Promise.reject(new Error('Fictional lost acknowledgement response'));
    });
    const result = await f.refresh(current.id, identifier(900), expected);
    expect(await f.refresh(current.id, identifier(900), expected)).toEqual(result);
    const card = (await f.scores.get(creator, event.id, f.unfinished)).cards.find((entry) => entry.playerId === f.first.id);
    await expect(f.scores.write({ kind: 'public-score', eventId: event.id }, event.id, f.unfinished,
      f.first.id, 2, { kind: 'strokes', strokes: 4 }, card?.etag ?? null, identifier(990)))
      .rejects.toMatchObject({ code: 'SCORE_INPUTS_CHANGED' });
    expect((await f.scores.write({ kind: 'public-score', eventId: event.id }, event.id, f.unfinished,
      f.first.id, 2, { kind: 'strokes', strokes: 4 }, card?.etag ?? null, identifier(990), identifier(900))).change)
      .toMatchObject({ id: identifier(990), expectedInputRevision: identifier(900) });
  });

  it('does not publish an acknowledgement after a concurrent deletion blocks event-owned writes', async () => {
    const f = await fixture();
    const current = await f.observe('12');
    f.submit.mockImplementationOnce((actions) => {
      f.apply(actions);
      return Promise.resolve({ status: 202, subResponses: [], getResponseForEntity: () => undefined });
    }).mockImplementationOnce((actions) => {
      f.seed({ partitionKey: event.id, rowKey: 'event-write-fence', state: 'blocked' });
      f.apply(actions);
      return Promise.resolve({ status: 202, subResponses: [], getResponseForEntity: () => undefined });
    });
    await expect(f.refresh(current.id)).rejects.toMatchObject({ code: 'EVENT_DELETION_IN_PROGRESS' });
    expect(f.rows.has(`${event.id}|player-index-refresh:${identifier(900)}`)).toBe(true);
    expect(f.rows.has(`${event.id}|player-index-refresh:${identifier(900)}:ack`)).toBe(false);
  });

  it('skips equal values without round revision churn and preserves existing review warnings', async () => {
    const f = await fixture('12');
    const equal = await f.observe('12.0');
    const before = f.rows.get(`${event.id}|round:${f.unfinished}`);
    expect((await f.refresh(equal.id)).updatedRoundIds).toEqual([]);
    expect(f.rows.get(`${event.id}|round:${f.unfinished}`)).toEqual(before);
    const row = f.rows.get(`${event.id}|round:${f.unfinished}`);
    const round = (await f.workspace.getForScoring(creator, event.id)).rounds.find((entry) => entry.id === f.unfinished);
    if (!round) throw new Error('Missing fictional round');
    const snapshot: RoundSnapshot = { ...round, inputRevision: identifier(901),
      reviewWarnings: [{ code: 'kp-review-required', message: 'Fictional unresolved KP review.' }] };
    f.seed({ ...row, partitionKey: event.id, rowKey: `round:${f.unfinished}`, content: canonical(snapshot) });
    const changed = await f.observe('15', 801);
    await expect(f.refresh(changed.id, identifier(901))).rejects.toMatchObject({ code: 'PLAYER_INDEX_REFRESH_REQUEST_CONFLICT' });
    await f.refresh(changed.id, identifier(902));
    expect((await f.workspace.getForScoring(creator, event.id)).rounds.find((entry) => entry.id === f.unfinished)?.reviewWarnings)
      .toEqual(expect.arrayContaining([...(snapshot.reviewWarnings ?? [])]));
  });

  it('aborts all round updates on an injected concurrent final-score event revision', async () => {
    const f = await fixture();
    await f.finishUnfinished(true);
    const current = await f.observe('12');
    const round = f.rows.get(`${event.id}|round:${f.unfinished}`);
    f.submit.mockImplementationOnce(async (actions) => {
      const state = await f.scores.get(creator, event.id, f.unfinished);
      const card = state.cards.find((entry) => entry.playerId === f.first.id);
      await f.scores.write(creator, event.id, f.unfinished, f.first.id, 18,
        { kind: 'strokes', strokes: 4 }, card?.etag ?? null, identifier(999));
      f.apply(actions);
      return { status: 202, subResponses: [], getResponseForEntity: () => undefined };
    });
    await expect(f.refresh(current.id)).rejects.toMatchObject({ code: 'EVENT_CHANGED' });
    expect(f.rows.get(`${event.id}|round:${f.unfinished}`)).toEqual(round);
    expect(f.rows.has(`${event.id}|player-index-refresh:${identifier(900)}`)).toBe(false);
    expect(f.rows.has(`${event.id}|score-change:${identifier(999)}`)).toBe(true);
  });

  it.each([
    ['lock', 'missing'], ['card', 'missing'], ['capture', 'missing'],
    ['lock', 'corrupt'], ['card', 'corrupt'], ['capture', 'corrupt'],
  ] as const)('fails closed on %s evidence that is %s', async (kind, failure) => {
    const f = await fixture();
    const current = await f.observe('12');
    const key = kind === 'lock' ? `score-lock:${f.unfinished}` : kind === 'capture'
      ? `index-capture:${f.unfinished}` : `score-card:${f.unfinished}:${f.first.id}`;
    if (failure === 'missing') f.rows.delete(`${event.id}|${key}`);
    else f.seed({ partitionKey: event.id, rowKey: key, content: canonical({ corrupt: true }) });
    await expect(f.refresh(current.id)).rejects.toMatchObject({ status: 503 });
    expect(f.rows.has(`${event.id}|player-index-refresh:${identifier(900)}`)).toBe(false);
  });

  it.each(['wolf-dots', 'churchy'] as const)('audits changed %s awards without rewriting saved cards, locks or original captures', async (kind) => {
    const f = await scoringFixture();
    for (const [index, playerId] of f.input.playerIds.entries()) {
      const profile = await f.players.get(creator, playerId);
      await f.players.observe(creator, playerId, identifier(1200 + index), {
        value: '0', effectiveDate: '2026-01-15', source: 'Fictional scratch observation',
      }, profile.etag);
    }
    const partnerId = f.input.playerIds[1] ?? '';
    const wolf = { id: identifier(1300), name: 'Fictional Net Wolf', kind: 'wolf' as const, version: 2 as const,
      basis: 'net' as const, groupNumber: 1, playerIds: f.input.playerIds, allowPig: true, stakeMinor: null };
    const churchy = { id: identifier(1301), name: 'Churchie', kind: 'churchy' as const, version: 3 as const,
      basis: 'net' as const, groupNumber: 1, playerIds: f.input.playerIds, orderMode: 'approach' as const,
      amountPerDotMinor: 50, currency: 'USD' as const, specials: defaultChurchySpecialSelections };
    const games: readonly RoundGameDefinition[] = kind === 'churchy' ? [churchy] : [wolf, {
      id: identifier(1302), name: 'Fictional Linked Dots', kind: 'dots', version: 1,
      groupNumber: 1, playerIds: f.input.playerIds, mode: 'linked', linkedGameId: wolf.id,
      specials: [{ kind: 'sweep', units: 1 }],
    }];
    let round = (await f.scores.saveGames(creator, event.id, f.roundId, games, null, identifier(1310))).round;
    for (const [index, playerId] of f.input.playerIds.entries()) {
      const score: HoleScore = { kind: 'strokes', strokes: index === 1 ? 4 : 5,
        ...(index === 0 ? kind === 'churchy' ? { churchy: {
          version: 3 as const, gameId: churchy.id, gameEtag: round.games?.configuration.etag ?? '',
          number: 1, players: [], contests: [], rotation: { playerIds: f.input.playerIds },
        } } : { wolf: [{ number: 1, choice: { gameId: wolf.id, gameEtag: round.games?.configuration.etag ?? '',
          mode: 'partner' as const, partnerId } }] } : {}) };
      round = (await f.scores.write(creator, event.id, f.roundId, playerId, 1, score, null, identifier(1320 + index))).round;
    }
    const preserved = new Map([...f.rows].filter(([key]) => key.startsWith(`${event.id}|score-`) || key.startsWith(`${event.id}|index-capture:`)));
    const player = await f.players.get(creator, f.playerId);
    const observed = await f.players.observe(creator, f.playerId, identifier(1330), {
      value: '18', effectiveDate: '2026-02-01', source: 'Fictional manual GHIN',
    }, player.etag);
    const observation = observed.currentIndex;
    if (!observation) throw new Error('Missing fictional observation');
    const expected = f.rows.get(`${event.id}|event`)?.etag ?? '';
    await f.workspace.refreshPlayerIndex(creator, event.id, f.playerId, observation.id, expected, identifier(1340));
    for (const [key, row] of preserved) expect(f.rows.get(key), key).toEqual(row);
    expect((await f.scores.get(creator, event.id, f.roundId)).cards).toEqual(round.cards);
    const key = `player-index-refresh:${identifier(1340)}`;
    const receipt: unknown = JSON.parse(await privateContent(f.table, event.id, key, f.rows.get(`${event.id}|${key}`)?.content));
    if (!isRecord(receipt) || !Array.isArray(receipt.corrections) || !receipt.corrections.every(isRoundCorrectionReceipt)) {
      throw new Error('Invalid fictional correction audit');
    }
    const correction = receipt.corrections[0];
    expect(correction?.warnings.map((warning) => warning.code)).toContain('purse-review-required');
    if (kind === 'churchy') expect(correction?.warnings.map((warning) => warning.code)).toContain('churchy-review-required');
    const audit = correction?.dotAwardAudit?.find((entry) => entry.kind === (kind === 'churchy' ? 'churchy' : 'wolf'));
    expect(audit?.inputRevision).toBe(identifier(1340));
    expect(audit?.configuration).toEqual(kind === 'churchy' ? churchy : wolf);
    expect(audit?.after.map((award) => award.kind)).toContain(kind === 'churchy' ? 'low' : 'wolf-high');
    if (kind === 'wolf-dots') {
      expect(correction?.dotAwardAudit?.find((entry) => entry.kind === 'dots')?.after.map((award) => award.kind)).toContain('sweep');
    }
  });
});
