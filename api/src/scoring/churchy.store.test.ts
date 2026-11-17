import { describe, expect, it } from 'vitest';
import type { ChurchyGameDefinition, ChurchyGameDefinitionV1, ChurchyGameDefinitionV2, ChurchySpecialsV1, ChurchySpecialsV2 } from '../../../src/domain/churchy.js';
import { defaultChurchySpecials, emptyChurchySpecials } from '../../../src/domain/churchy.js';
import { isHoleScore, isRoundScores, isScoreWriteResult } from '../../../src/contracts/scoring.js';
import { scoringFixture } from '../../test/scoring-fixtures.js';
import { publicFixture } from '../public-access/test-support.js';
import { identifier } from '../../test/catalog-fixtures.js';
import { creator, event, member } from '../../test/fixtures.js';
import { TableScoreStore } from './store.js';
import { stablefordPoints } from '../../../src/domain/stableford.js';
import { testerFixture } from '../test-access/test-support.js';
import type { BallDropGameDefinition } from '../../../src/domain/games.js';
import { parseScoreWriteBody } from './handlers.js';

function game(ids: readonly string[]): ChurchyGameDefinitionV1 {
  return { id: identifier(702), name: 'Churchy Game', kind: 'churchy', version: 1, basis: 'net',
    groupNumber: 1, playerIds: ids.slice(0, 4), currency: 'USD', amountPerDotMinor: 100 };
}
function extras(game: ChurchyGameDefinition, etag: string): ChurchySpecialsV1 {
  return { gameId: game.id, gameEtag: etag, paree: true, murphy: true, murphyPresses: 2, sandy: false, pully: false };
}
function gameV2(ids: readonly string[], groupNumber = 1): ChurchyGameDefinitionV2 {
  return { ...game(ids), version: 2, groupNumber, id: identifier(710 + groupNumber),
    enabledSpecials: defaultChurchySpecials };
}
function extrasV2(game: ChurchyGameDefinitionV2, etag: string): ChurchySpecialsV2 {
  const empty = emptyChurchySpecials(game, etag);
  if (empty.version !== 2) throw new Error('Expected fictional v2 specials');
  return { ...empty, sticky: true, sandyCount: 2, otherDots: 3 };
}
describe('Churchy atomic audited storage and authoritative kill switch', () => {
  it('can add the separate game to already captured cards without unlocking setup or converting a bound game', async () => {
    const f = await scoringFixture();
    await f.write();
    const definition = game(f.input.playerIds);
    const added = await f.scores.saveGames(creator, event.id, f.roundId, [definition], null, identifier(800));
    expect(added.round.setupLocked).toBe(true);
    expect(added.round.games?.configuration.games).toEqual([definition]);
    expect(isRoundScores(added.round)).toBe(true);
  });

  describe('Churchy v2 saved-foursome boundaries', () => {
    it('lets public visitors configure and score two independent foursomes without Ball Drop or general game authority', async () => {
      const f = await publicFixture();
      const firstDefinition = gameV2(f.input.playerIds);
      const secondDefinition = gameV2(f.input.playerIds.slice(4), 2);
      const definitions = [firstDefinition, secondDefinition];
      const ballDrop: BallDropGameDefinition = { id: identifier(705), name: 'Fictional independent Ball Drop',
        kind: 'ball-drop', version: 1, basis: 'net', format: 'ball-drop-net-gross',
        teams: f.input.rounds[0]?.groups.map((group) => ({ id: identifier(705 + group.number),
          name: `Fictional team ${String(group.number)}`, playerIds: group.playerIds })) ?? [] };
      const protectedPeer = await f.scores.saveGames(creator, event.id, f.roundId, [ballDrop], null, identifier(809));
      const configured = await f.scores.saveGames(f.actor, event.id, f.roundId, [ballDrop, ...definitions],
        protectedPeer.round.games?.configuration.etag ?? null, identifier(810));
      expect(configured.round).toMatchObject({ churchyRulesVersions: [1, 2], churchyEnabled: true,
        permissions: { role: 'public', canManageGames: false, canManageInternalGames: true } });
      expect(isRoundScores(configured.round)).toBe(true);
      const revision = configured.round.games?.configuration.etag ?? '';
      const first = await f.scores.write(f.actor, event.id, f.roundId, f.playerId, 1,
        { kind: 'strokes', strokes: 4, churchy: extrasV2(firstDefinition, revision) }, null, identifier(811));
      const second = await f.scores.write(f.actor, event.id, f.roundId, f.peerId, 1,
        { kind: 'strokes', strokes: 3, churchy: extrasV2(secondDefinition, revision) }, null, identifier(812));
      expect(first.round.setupLocked).toBe(true);
      expect(isScoreWriteResult(second)).toBe(true);
      expect(second.round.games?.configuration.games[0]).toEqual(ballDrop);
      expect(second.round.games?.results.filter((result) => result.kind === 'churchy').map((result) => result.players.map((player) => player.playerId)))
        .toEqual(definitions.map((definition) => definition.playerIds));
      expect(second.change.recordedBy).toEqual(f.actor);
      expect(second.change).not.toHaveProperty('dotAwardAudit');
      await expect(f.scores.write(f.actor, event.id, f.roundId, f.peerId, 2,
        { kind: 'strokes', strokes: 4, churchy: extrasV2(firstDefinition, revision) },
        second.round.cards.find((card) => card.playerId === f.peerId)?.etag ?? null, identifier(813)))
        .rejects.toMatchObject({ code: 'CHURCHY_SETUP_CHANGED' });
      const fresh = await publicFixture();
      const duplicate = { ...firstDefinition, id: identifier(719) };
      await expect(fresh.scores.saveGames(fresh.actor, event.id, fresh.roundId,
        [firstDefinition, duplicate], null, identifier(814))).rejects.toMatchObject({ code: 'INVALID_GAME_SETUP' });
      const stableford = { id: identifier(720), name: 'Fictional protected peer', basis: 'gross' as const,
        preset: 'standard' as const, handicapAllowancePercent: 95, points: stablefordPoints('standard') };
      await expect(fresh.scores.saveGames(fresh.actor, event.id, fresh.roundId,
        [firstDefinition, stableford], null, identifier(815))).rejects.toMatchObject({ code: 'SCORES_OWNER_REQUIRED' });
    });
    it('acknowledges unplayed manual specials, captures the whole round, and never requires invented numeric scores', async () => {
      const f = await publicFixture();
      const definition = { ...gameV2(f.input.playerIds), enabledSpecials: ['sticky'] as const };
      const configured = await f.scores.saveGames(f.actor, event.id, f.roundId, [definition], null, identifier(880));
      const special = emptyChurchySpecials(definition, configured.round.games?.configuration.etag ?? '');
      if (special.version !== 2) throw new Error('Expected fictional v2 specials');
      const score = { kind: 'unplayed' as const, churchy: { ...special, sticky: true, otherDots: 2 } };
      const saved = await f.scores.write(f.actor, event.id, f.roundId, f.playerId, 1, score, null, identifier(881));
      expect(isScoreWriteResult(saved)).toBe(true);
      expect(saved.change.after).toEqual(score);
      expect(saved.round.setupLocked).toBe(true);
      expect(saved.round.games?.results[0]?.churchy?.holes[0]?.specials).toEqual(expect.arrayContaining([
        expect.objectContaining({ special: 'Sticky', dots: 1 }),
        expect.objectContaining({ special: 'Other', dots: 2 }),
      ]));
      const workspace = await f.workspace.get(creator, event.id);
      expect(workspace.rounds[0]?.scoringStarted).toBe(true);
      expect(workspace.rounds[0]?.players).toHaveLength(8);
      expect((await f.scores.write(f.actor, event.id, f.roundId, f.playerId, 1, score, null, identifier(881))).change).toEqual(saved.change);
    });
    it('checks every configured foursome before owner corrections, not only the first Churchy game', async () => {
      const f = await publicFixture();
      const definitions = [gameV2(f.input.playerIds), gameV2(f.input.playerIds.slice(4), 2)];
      await f.scores.saveGames(creator, event.id, f.roundId, definitions, null, identifier(890));
      await f.write();
      const model = await f.workspace.correctionModel(creator, event.id, f.roundId);
      await expect(f.workspace.correctRound(creator, event.id, f.roundId, identifier(891), {
        expected: { eventEtag: model.eventEtag, roundEtag: model.roundEtag, gamesEtag: model.gamesEtag ?? null,
          inputRevision: model.inputRevision ?? null },
        reason: 'Fictional incompatible second group correction',
        correction: { teeProfileId: model.teeProfileId,
          groups: model.groups.map((group) => group.number === 2 ? { ...group, playerIds: [...group.playerIds].reverse() } : group),
          players: model.players.map((player) => ({ playerId: player.playerId, handicapIndexValue: player.handicapIndex?.value ?? null })) },
      })).rejects.toMatchObject({ code: 'CHURCHY_SETUP_CHANGED' });
    });
    it('rejects malformed, disabled, wrong-version and stale declarations before any score transaction', async () => {
      const f = await scoringFixture();
      const definition = { ...gameV2(f.input.playerIds), enabledSpecials: [] };
      const configured = await f.scores.saveGames(creator, event.id, f.roundId, [definition], null, identifier(820));
      const special = emptyChurchySpecials(definition, configured.round.games?.configuration.etag ?? '');
      if (special.version !== 2) throw new Error('Expected fictional v2 specials');
      f.submit.mockClear();
      for (const edit of [
        { sandyCount: -1 }, { otherDots: 1.5 }, { sandyCount: Number.MAX_SAFE_INTEGER + 1 },
        { otherDots: '1' }, { version: 3 },
      ]) {
        const score = { kind: 'strokes', strokes: 4, churchy: { ...special, ...edit } };
        expect(isHoleScore(score)).toBe(false);
        expect(() => parseScoreWriteBody({ score })).toThrow('INVALID_HOLE_SCORE');
      }
      for (const [index, edit] of [
        { sticky: true }, { sandyCount: 1 }, { paree: true }, { murphy: true }, { pully: true },
        { gameEtag: 'fictional-stale' },
      ].entries()) {
        await expect(f.scores.write(creator, event.id, f.roundId, f.playerId, 1,
          { kind: 'strokes', strokes: 4, churchy: { ...special, ...edit } }, null, identifier(830 + index)))
          .rejects.toMatchObject({ code: 'CHURCHY_SETUP_CHANGED' });
      }
      await expect(f.scores.write(creator, event.id, f.roundId, f.playerId, 1,
        { kind: 'strokes', strokes: 4, churchy: extras(definition, special.gameEtag) }, null, identifier(839)))
        .rejects.toMatchObject({ code: 'CHURCHY_SETUP_CHANGED' });
      expect(f.submit).not.toHaveBeenCalled();
      const saved = await f.scores.write(creator, event.id, f.roundId, f.playerId, 1,
        { kind: 'did-not-finish', churchy: { ...special, otherDots: 2 } }, null, identifier(840));
      expect(saved.change.after.churchy).toEqual({ ...special, otherDots: 2 });
    });
    it('keeps game versions immutable and locks v2 toggles/order while retaining owner stake edits', async () => {
      const f = await scoringFixture();
      const legacy = game(f.input.playerIds);
      const configured = await f.scores.saveGames(creator, event.id, f.roundId, [legacy], null, identifier(850));
      await expect(f.scores.saveGames(creator, event.id, f.roundId,
        [{ ...gameV2(f.input.playerIds), id: legacy.id }], configured.round.games?.configuration.etag ?? null, identifier(851)))
        .rejects.toMatchObject({ code: 'CHURCHY_REQUIRES_NEW_GAME' });
      const fresh = await scoringFixture();
      const definition = gameV2(fresh.input.playerIds);
      const first = await fresh.scores.saveGames(creator, event.id, fresh.roundId, [definition], null, identifier(852));
      const revision = first.round.games?.configuration.etag ?? null;
      await expect(fresh.scores.saveGames(creator, event.id, fresh.roundId,
        [{ ...legacy, id: definition.id }], revision, identifier(853))).rejects.toMatchObject({ code: 'CHURCHY_REQUIRES_NEW_GAME' });
      await fresh.write();
      for (const [index, edit] of [
        { enabledSpecials: [] }, { playerIds: [...definition.playerIds].reverse() },
      ].entries()) {
        await expect(fresh.scores.saveGames(creator, event.id, fresh.roundId,
          [{ ...definition, ...edit }], revision, identifier(854 + index))).rejects.toMatchObject({ code: 'CHURCHY_SETUP_LOCKED' });
      }
      const stakes = await fresh.scores.saveGames(creator, event.id, fresh.roundId,
        [{ ...definition, amountPerDotMinor: 50 }], revision, identifier(856));
      expect(stakes.round.games?.configuration.games[0]).toMatchObject({ amountPerDotMinor: 50, version: 2 });
      const scored = await scoringFixture();
      await scored.write();
      await expect(scored.scores.saveGames(creator, event.id, scored.roundId,
        [gameV2(scored.input.playerIds)], null, identifier(857))).rejects.toMatchObject({ code: 'CHURCHY_SETUP_LOCKED' });
    });
    it('preserves v2 extras on raw-only writes and immutable retries through disable/re-enable and later edits', async () => {
      const f = await scoringFixture();
      let enabled = false;
      const scores = new TableScoreStore(f.table, f.workspace, () => enabled);
      const definition = gameV2(f.input.playerIds);
      expect((await scores.get(creator, event.id, f.roundId)).churchyRulesVersions).toBeUndefined();
      await expect(scores.saveGames(creator, event.id, f.roundId, [definition], null, identifier(860)))
        .rejects.toMatchObject({ code: 'CHURCHY_DISABLED' });
      enabled = true;
      const configured = await scores.saveGames(creator, event.id, f.roundId, [definition], null, identifier(861));
      const special = extrasV2(definition, configured.round.games?.configuration.etag ?? '');
      const score = { kind: 'strokes' as const, strokes: 4, churchy: special };
      f.submit.mockImplementationOnce((actions) => { f.apply(actions); return Promise.reject(new Error('Fictional lost v2 receipt')); });
      const first = await scores.write(creator, event.id, f.roundId, f.playerId, 1, score, null, identifier(862));
      expect(isScoreWriteResult(first)).toBe(true);
      enabled = false;
      const hidden = await scores.get(creator, event.id, f.roundId);
      expect(hidden.churchyRulesVersions).toBeUndefined();
      expect(hidden.games?.configuration.games).toEqual([definition]);
      expect(isRoundScores(hidden)).toBe(true);
      const raw = await scores.write(creator, event.id, f.roundId, f.playerId, 1, { kind: 'strokes', strokes: 5 },
        first.round.cards[0]?.etag ?? null, identifier(863));
      expect(raw.change.after.churchy).toEqual(special);
      expect(isScoreWriteResult(raw)).toBe(true);
      const replay = await scores.write(creator, event.id, f.roundId, f.playerId, 1, score, null, identifier(862));
      expect(replay.change).toEqual(first.change);
      expect(replay.round.cards[0]?.holes[0]?.score).toMatchObject({ strokes: 5, churchy: special });
      await expect(scores.write(creator, event.id, f.roundId, f.playerId, 1,
        { ...score, churchy: { ...special, otherDots: 4 } }, null, identifier(862)))
        .rejects.toMatchObject({ code: 'SCORE_REQUEST_CONFLICT' });
      await expect(scores.write(creator, event.id, f.roundId, f.playerId, 1,
        { ...score, churchy: { ...special, otherDots: 4 } }, raw.round.cards[0]?.etag ?? null, identifier(864)))
        .rejects.toMatchObject({ code: 'CHURCHY_DISABLED' });
      enabled = true;
      const last = await scores.write(creator, event.id, f.roundId, f.playerId, 1,
        { ...score, churchy: { ...special, otherDots: 4 } }, raw.round.cards[0]?.etag ?? null, identifier(865));
      expect(last.change.after.churchy).toMatchObject({ version: 2, otherDots: 4 });
      expect((await scores.history(creator, event.id, f.roundId, f.playerId)).changes).toHaveLength(3);
    });
    it('keeps v1 tester shapes while withholding v2 definitions, declarations, capabilities and ledgers', async () => {
      const f = await testerFixture();
      const definition = gameV2(f.input.playerIds);
      const configured = await f.scores.saveGames(creator, event.id, f.roundId, [definition], null, identifier(870));
      const special = extrasV2(definition, configured.round.games?.configuration.etag ?? '');
      const first = await f.scores.write(creator, event.id, f.roundId, f.playerId, 1,
        { kind: 'strokes', strokes: 4, churchy: special }, null, identifier(871));
      const tester = await f.scores.get(f.actor, event.id, f.roundId);
      expect(isRoundScores(tester)).toBe(true);
      expect(tester.churchyRulesVersions).toBeUndefined();
      expect(tester.internalSettlements).toBeUndefined();
      expect(tester.games?.configuration.games).toEqual([]);
      expect(tester.cards[0]?.holes[0]?.score).toEqual({ kind: 'strokes', strokes: 4 });
      await expect(f.scores.write(f.actor, event.id, f.roundId, f.playerId, 1,
        { kind: 'strokes', strokes: 4, churchy: special }, first.round.cards[0]?.etag ?? null, identifier(872)))
        .rejects.toMatchObject({ code: 'MATCH_DECLARATIONS_NOT_ALLOWED' });
      const raw = await f.scores.write(f.actor, event.id, f.roundId, f.playerId, 1,
        { kind: 'strokes', strokes: 5 }, first.round.cards[0]?.etag ?? null, identifier(873));
      expect(isScoreWriteResult(raw)).toBe(true);
      expect(raw.change.after).toEqual({ kind: 'strokes', strokes: 5 });
      expect((await f.scores.get(creator, event.id, f.roundId)).cards[0]?.holes[0]?.score.churchy).toEqual(special);
      const legacy = await testerFixture();
      const v1 = game(legacy.input.playerIds);
      const old = await legacy.scores.saveGames(creator, event.id, legacy.roundId, [v1], null, identifier(874));
      const saved = await legacy.scores.write(legacy.actor, event.id, legacy.roundId, legacy.playerId, 1,
        { kind: 'strokes', strokes: 4, churchy: extras(v1, old.round.games?.configuration.etag ?? '') }, null, identifier(875));
      expect(saved.round.churchyRulesVersions).toBeUndefined();
      expect(saved.round.games?.configuration.games).toEqual([v1]);
      expect(saved.change.after.churchy).toHaveProperty('sandy', false);
      expect(saved.change.after.churchy).not.toHaveProperty('version');
    });
  });
  it('allows public scoring only the selected saved foursome; saves disposition and dots in one audit with replay', async () => {
    const f = await publicFixture();
    const definition = game(f.input.playerIds);
    const configured = await f.scores.saveGames(creator, event.id, f.roundId, [definition], null, identifier(800));
    expect(configured.round.churchyEnabled).toBe(true);
    const special = extras(definition, configured.round.games?.configuration.etag ?? '');
    const score = { kind: 'picked-up' as const, reportedStrokes: 7, churchy: special };
    f.submit.mockImplementationOnce((actions) => { f.apply(actions); return Promise.reject(new Error('Fictional lost receipt')); });
    const saved = await f.scores.write(f.actor, event.id, f.roundId, f.playerId, 1, score, null, identifier(801));
    expect(isScoreWriteResult(saved)).toBe(true);
    expect(saved.change.after).toEqual(score);
    expect(saved.change.recordedBy).toEqual(f.actor);
    expect(saved.round.games?.results[0]?.players).toHaveLength(4);
    expect(saved.round.cards[0]?.holes[0]?.score).toEqual(score);
    expect((await f.scores.history(creator, event.id, f.roundId, f.playerId)).changes[0]?.after).toEqual(score);
    expect((await f.scores.write(f.actor, event.id, f.roundId, f.playerId, 1, score, null, identifier(801))).change).toEqual(saved.change);
    await expect(f.scores.write(f.actor, event.id, f.roundId, f.peerId, 1, score, null, identifier(802)))
      .rejects.toMatchObject({ code: 'CHURCHY_SETUP_CHANGED' });
    await expect(f.scores.saveGames(member, event.id, f.roundId, [definition], configured.round.games?.configuration.etag ?? null, identifier(803)))
      .rejects.toMatchObject({ status: 404, code: 'EVENT_NOT_FOUND' });
  });
  it('disabled retains hidden definitions/audits/specials and allows raw score and other game edits but refuses changed specials', async () => {
    const f = await scoringFixture();
    let enabled = true;
    const scores = new TableScoreStore(f.table, f.workspace, () => enabled);
    const definition = game(f.input.playerIds);
    const stableford = { id: identifier(703), name: 'Fictional Stableford', basis: 'gross' as const,
      preset: 'standard' as const, handicapAllowancePercent: 95, points: stablefordPoints('standard') };
    const configured = await scores.saveGames(creator, event.id, f.roundId, [definition, stableford], null, identifier(800));
    const special = extras(definition, configured.round.games?.configuration.etag ?? '');
    const first = await scores.write(creator, event.id, f.roundId, f.playerId, 1,
      { kind: 'strokes', strokes: 4, churchy: special }, null, identifier(801));
    enabled = false;
    const read = await scores.get(creator, event.id, f.roundId);
    expect(read.churchyEnabled).toBe(false);
    expect(isRoundScores(read)).toBe(true);
    expect(read.games?.configuration.games[0]).toEqual(definition);
    const raw = await scores.write(creator, event.id, f.roundId, f.playerId, 1,
      { kind: 'strokes', strokes: 5 }, first.round.cards[0]?.etag ?? null, identifier(802));
    expect(raw.change.after.churchy).toEqual(special);
    await expect(scores.write(creator, event.id, f.roundId, f.playerId, 1, {
      kind: 'strokes', strokes: 5, churchy: { ...special, sandy: true },
    }, raw.round.cards[0]?.etag ?? null, identifier(803))).rejects.toMatchObject({ code: 'CHURCHY_DISABLED' });
    await expect(scores.saveGames(creator, event.id, f.roundId, [{ ...definition, amountPerDotMinor: 200 }, stableford],
      read.games?.configuration.etag ?? null, identifier(804))).rejects.toMatchObject({ code: 'CHURCHY_DISABLED' });
    const other = await scores.saveGames(creator, event.id, f.roundId, [definition, { ...stableford, name: 'Fictional edited Stableford' }],
      read.games?.configuration.etag ?? null, identifier(805));
    expect(other.round.games?.configuration.games[0]).toEqual(definition);
    expect((await scores.history(creator, event.id, f.roundId, f.playerId)).changes[0]?.after.churchy).toEqual(special);
  });
  it('checks current game proof, rejects stale specials, locks order after scoring, and keeps owner-only stake edits independent', async () => {
    const f = await scoringFixture();
    const definition = game(f.input.playerIds);
    const first = await f.scores.saveGames(creator, event.id, f.roundId, [definition], null, identifier(800));
    const stale = extras(definition, first.round.games?.configuration.etag ?? '');
    const second = await f.scores.saveGames(creator, event.id, f.roundId, [{ ...definition, amountPerDotMinor: 200 }],
      first.round.games?.configuration.etag ?? null, identifier(801));
    await expect(f.scores.write(creator, event.id, f.roundId, f.playerId, 1,
      { kind: 'strokes', strokes: 4, churchy: stale }, null, identifier(802))).rejects.toMatchObject({ code: 'CHURCHY_SETUP_CHANGED' });
    await f.write();
    await expect(f.scores.saveGames(creator, event.id, f.roundId, [{ ...definition, playerIds: [...definition.playerIds].reverse() }],
      second.round.games?.configuration.etag ?? null, identifier(803))).rejects.toMatchObject({ code: 'CHURCHY_SETUP_LOCKED' });
    const third = await f.scores.saveGames(creator, event.id, f.roundId, [{ ...definition, amountPerDotMinor: 300 }],
      second.round.games?.configuration.etag ?? null, identifier(804));
    expect(third.round.games?.configuration.games[0]).toMatchObject({ amountPerDotMinor: 300 });
  });
});
