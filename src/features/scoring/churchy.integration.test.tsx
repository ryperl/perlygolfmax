import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { OwnerScoresView } from './OwnerScoresView';
import { churchyFixture } from '../../domain/churchy.test-support';
import { memoryScores, deferred } from './scoring.test-support';
import { RoundGamesPanel } from '../games';
import { RoundLeaderboard } from '../leaderboard';
import { SavedScorecards } from './SavedScorecards';
import { draftFromGame, buildGame } from '../games/game-draft';
import { GameSettings } from '../games/GameSettings';
import { createScoresClient } from '../../client/scoring';
import { useState } from 'react';
import type { RoundGameDefinition } from '../../domain/games';
import type { RoundScores } from '../../domain/scoring';
import { calculateGameResults } from '../../domain/stableford';

beforeAll(() => {
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: { configurable: true, value(this: HTMLDialogElement) { this.setAttribute('open', ''); } },
    close: { configurable: true, value(this: HTMLDialogElement) { this.removeAttribute('open'); this.dispatchEvent(new Event('close')); } },
  });
});
afterAll(() => {
  Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal');
  Reflect.deleteProperty(HTMLDialogElement.prototype, 'close');
});
describe('Churchy workflow integration', () => {
  it('creates Churchy as a separate owner game with an explicit saved foursome, swapped order and exact stake, retaining peers', async () => {
    const f = churchyFixture();
    const saved = f.round();
    const initial: RoundScores = { ...saved, games: { configuration: {
      eventId: saved.eventId, roundId: saved.roundId, etag: f.extras.gameEtag, games: [f.skins],
    }, results: calculateGameResults([f.skins], f.snapshot, f.cards) } };
    const record = vi.fn<(games: readonly RoundGameDefinition[]) => void>();
    function Harness() {
      const [round, setRound] = useState(initial);
      return <RoundGamesPanel round={round} busy={false} onDirtyChange={vi.fn()} onRefresh={() => Promise.resolve(round)}
        onSave={(games, expectedEtag, id) => {
          record(games);
          const next = { ...round, games: { configuration: { eventId: round.eventId, roundId: round.roundId,
            etag: 'fictional-next-game', games }, results: calculateGameResults(games, f.snapshot, round.cards) } };
          setRound(next);
          return Promise.resolve({ round: next, change: { id, eventId: round.eventId, roundId: round.roundId, expectedEtag,
            before: round.games?.configuration.games ?? [], after: games, recordedAt: '2026-01-01T00:00:00Z',
            recordedBy: { tenantId: '00000000-0000-4000-8000-000000000501', objectId: '00000000-0000-4000-8000-000000000502' } } });
        }} />;
    }
    render(<Harness />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Add game' }));
    await user.selectOptions(screen.getByLabelText('Game type'), 'churchy');
    await user.selectOptions(screen.getByLabelText('Churchy playing group'), '1');
    await user.type(screen.getByLabelText('USD cents per dot'), '100');
    const second = f.game.playerIds[1];
    if (!second) throw new Error('Missing fictional group member');
    await user.selectOptions(screen.getByLabelText('P1'), second);
    await user.click(screen.getByRole('button', { name: 'Save game' }));
    expect(await screen.findByText('Game settings saved.')).toBeVisible();
    expect(record).toHaveBeenCalledWith([f.skins, expect.objectContaining({ kind: 'churchy', name: 'Churchy Game',
      amountPerDotMinor: 100, groupNumber: 1, playerIds: [second, f.game.playerIds[0], ...f.game.playerIds.slice(2)] })]);
  });
  it('leaves nonselected group scorecards unchanged instead of adding fake zero or unavailable Churchy rows', () => {
    const f = churchyFixture();
    render(<SavedScorecards round={f.round()} groupNumber={2} busy={false} onGroupChange={vi.fn()} onEnterScores={vi.fn()} />);
    expect(screen.queryByText(/Churchy/)).toBeNull();
    expect(screen.queryByText(/Earned dots/)).toBeNull();
  });
  it('specials-only edit uses the same score transaction, remains on hole until acknowledgement, and guards/discards drafts', async () => {
    const f = churchyFixture();
    const initial = f.round();
    const store = memoryScores(initial);
    const original = vi.mocked(store.client.save).getMockImplementation();
    if (!original) throw new Error('Missing fictional saver');
    render(<OwnerScoresView client={store.client} eventId={initial.eventId} roundId={initial.roundId} onSessionExpired={vi.fn()} />);
    const user = userEvent.setup();
    await screen.findByRole('heading', { name: 'Round scorecard' });
    await user.click(screen.getByRole('button', { name: 'Enter scores' }));
    await user.click(screen.getByRole('button', { name: 'Dots for Fictional golfer 1' }));
    const dialog = within(screen.getByRole('dialog'));
    await user.click(dialog.getByLabelText(/Murphy called/));
    await user.click(dialog.getByRole('button', { name: /Opposing team presses/ }));
    await user.click(dialog.getByRole('button', { name: /Calling team presses back/ }));
    await user.click(dialog.getByRole('button', { name: 'Return to score entry' }));
    expect(screen.getByRole('button', { name: 'Discard unsaved scores' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Next hole' }));
    expect(screen.getByRole('heading', { name: 'Hole 1' })).toBeVisible();
    const pending = deferred<Awaited<ReturnType<typeof store.client.save>>>();
    vi.mocked(store.client.save).mockReturnValueOnce(pending.promise);
    await user.click(screen.getByRole('button', { name: 'Save & Next Hole' }));
    expect(screen.getByRole('heading', { name: 'Hole 1' })).toBeVisible();
    const call = vi.mocked(store.client.save).mock.calls[0];
    if (!call) throw new Error('Missing fictional score write');
    expect(call[4]).toMatchObject({ kind: 'strokes', strokes: 4, churchy: { murphy: true, murphyPresses: 2 } });
    await act(async () => { pending.resolve(await original(...call)); });
    expect(await screen.findByRole('heading', { name: 'Hole 2' })).toBeVisible();
    expect(store.client.save).toHaveBeenCalledOnce();
  });
  it.each([false, undefined])('hides every experimental surface for off/old capability %s while retaining known definitions and ordinary games', (enabled) => {
    const f = churchyFixture();
    const round = { ...f.round(), ...(enabled === undefined ? {} : { churchyEnabled: enabled }) };
    if (enabled === undefined) Reflect.deleteProperty(round, 'churchyEnabled');
    render(<><RoundGamesPanel round={round} busy={false} onDirtyChange={vi.fn()} onSave={vi.fn()} onRefresh={vi.fn()} />
      <RoundLeaderboard round={round} busy={false} onManageGames={vi.fn()} />
      <SavedScorecards round={round} groupNumber={1} busy={false} onGroupChange={vi.fn()} onEnterScores={vi.fn()} /></>);
    expect(screen.queryByText(/Churchy/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Edit Fictional Skins' })).toBeVisible();
    expect(round.games?.configuration.games[0]).toEqual(f.game);
  });
  it('builds explicit owner group/order and exact cents without Stableford/Skins controls', () => {
    const f = churchyFixture();
    const onChange = vi.fn();
    render(<GameSettings draft={draftFromGame(f.game)} churchyEnabled groups={f.snapshot.groups} roster={f.cards}
      disabled={false} saveDisabled={false} cancelDisabled={false} retry={false} onChange={onChange} onSave={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByLabelText('USD cents per dot')).toHaveValue('100');
    expect(screen.queryByLabelText('Points preset')).toBeNull();
    expect(screen.queryByLabelText('Score basis')).toBeNull();
    expect(screen.getByText(/Holes 1–3 and 10–12/)).toBeVisible();
    fireEvent.change(screen.getByLabelText('P1'), { target: { value: f.game.playerIds[1] } });
    const draft: unknown = onChange.mock.calls[0]?.[0];
    expect(draft).toMatchObject({ churchyPlayers: [f.game.playerIds[1], f.game.playerIds[0], ...f.game.playerIds.slice(2)] });
    expect(buildGame(draftFromGame(f.game), f.game.playerIds)).toEqual(f.game);
  });
  it('the real client retains and validates specials in request and acknowledgement, including disabled preserved extras', async () => {
    const f = churchyFixture();
    const round = f.round();
    const playerId = f.game.playerIds[0];
    if (!playerId) throw new Error('Missing fictional golfer');
    const score = { kind: 'strokes' as const, strokes: 4, churchy: f.extras };
    const change = { id: f.game.id, eventId: round.eventId, roundId: round.roundId, playerId,
      holeNumber: 1, expectedEtag: 'fictional-card-v1', before: score, after: score,
      recordedAt: '2026-01-01T00:00:00Z', recordedBy: { kind: 'public-score' as const, eventId: round.eventId } };
    const send = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ round, change }), { status: 200 }));
    const client = createScoresClient('http://127.0.0.1:9000', () => Promise.resolve(''), send, 'None');
    const result = await client.save(round.eventId, round.roundId, playerId, 1, score, change.expectedEtag, change.id, new AbortController().signal);
    expect(result.change.after.churchy).toEqual(f.extras);
    expect(send.mock.calls[0]?.[1]?.body).toBe(JSON.stringify({ score }));
  });
});
