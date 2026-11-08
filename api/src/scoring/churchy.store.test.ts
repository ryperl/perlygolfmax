import { describe, expect, it } from 'vitest';
import type { ChurchyGameDefinition, ChurchySpecials } from '../../../src/domain/churchy.js';
import { isRoundScores, isScoreWriteResult } from '../../../src/contracts/scoring.js';
import { scoringFixture } from '../../test/scoring-fixtures.js';
import { publicFixture } from '../public-access/test-support.js';
import { identifier } from '../../test/catalog-fixtures.js';
import { creator, event, member } from '../../test/fixtures.js';
import { TableScoreStore } from './store.js';
import { stablefordPoints } from '../../../src/domain/stableford.js';

function game(ids: readonly string[]): ChurchyGameDefinition {
  return { id: identifier(702), name: 'Churchy Game', kind: 'churchy', version: 1, basis: 'net',
    groupNumber: 1, playerIds: ids.slice(0, 4), currency: 'USD', amountPerDotMinor: 100 };
}
function extras(game: ChurchyGameDefinition, etag: string): ChurchySpecials {
  return { gameId: game.id, gameEtag: etag, paree: true, murphy: true, murphyPresses: 2, sandy: false, pully: false };
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
