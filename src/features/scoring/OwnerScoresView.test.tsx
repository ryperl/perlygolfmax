import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { EventChangedError, SessionExpiredError } from '../../client/events';
import { fakeScores, fictionalChange, fictionalRoundScores, scoreResult } from '../../client/scoring.test-support';
import { fictionalId } from '../../client/catalog.test-support';
import type { RoundScores, ScoreWriteResult } from '../../domain/scoring';
import { OwnerScoresView } from './OwnerScoresView';

function hole(number = 1, player = 'Fictional Player 1') {
  return within(screen.getByRole('form', { name: `${player} hole ${String(number)}` }));
}
async function enterStrokes(user: ReturnType<typeof userEvent.setup>, number = 1, strokes = '4') {
  await user.selectOptions(hole(number).getByRole('combobox'), 'strokes');
  await user.type(hole(number).getByRole('textbox'), strokes);
}
function mount(client = fakeScores()) {
  const onSessionExpired = vi.fn();
  return { client, onSessionExpired, ...render(<OwnerScoresView client={client} eventId={fictionalRoundScores.eventId}
    roundId={fictionalRoundScores.roundId} onSessionExpired={onSessionExpired} />) };
}
async function loaded() {
  await screen.findByRole('article', { name: 'Fictional Player 1 scorecard' });
}
describe('online owner gross scorecards', () => {
  it('shows saved source layout, all cards in group order, incomplete totals and honest online-only copy', async () => {
    const { client } = mount();
    await loaded();
    expect(screen.getAllByRole('article').map((card) => card.getAttribute('aria-label'))).toEqual([
      'Fictional Player 1 scorecard', 'Fictional Player 2 scorecard', 'Fictional Player 3 scorecard', 'Fictional Player 4 scorecard',
    ]);
    expect(screen.getByRole('table', { name: 'Saved source layout' })).toHaveTextContent('Source hole');
    expect(screen.getByRole('table')).toHaveTextContent('9000');
    expect(screen.getByRole('table')).toHaveTextContent('Yardage');
    expect(screen.getAllByText(/Incomplete — no final gross/)).toHaveLength(4);
    expect(screen.getByText(/Unsaved drafts live only in this page/)).toBeVisible();
    expect(screen.getByText('Finish setup before saving the first score.')).toBeVisible();
    expect(screen.getByText(/The first accepted score locks this saved round's course, tee, players, groups and captured Handicap Index inputs/)).toHaveTextContent('Clearing scores does not unlock these inputs.');
    expect(screen.queryByText(/Scoring has started:/)).not.toBeInTheDocument();
    expect(client.save).not.toHaveBeenCalled();
    expect(screen.queryByText(/Leaderboard/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh saved round' })).toBeEnabled();
  });
  it('renders dispositions without treating them as zero, and only displays a complete numeric card total', async () => {
    const client = fakeScores();
    const mixed: RoundScores = { ...scoreResult().round, cards: scoreResult().round.cards.map((card, i) => ({
      ...card, etag: 'card-v1', updatedAt: fictionalChange.recordedAt,
      holes: card.holes.map((item, index) => ({ ...item, score: i === 1 ? { kind: 'strokes', strokes: 4 }
        : index === 0 ? { kind: 'picked-up' } : index === 1 ? { kind: 'did-not-finish' }
          : index === 2 ? { kind: 'strokes', strokes: 5 } : { kind: 'unplayed' } })),
    })) };
    vi.mocked(client.load).mockResolvedValue(mixed);
    mount(client);
    await loaded();
    expect(hole().getByText('Saved: Picked up')).toBeVisible();
    expect(hole(2).getByText('Saved: DNF (hole)')).toBeVisible();
    expect(screen.getAllByText(/Saved numeric strokes: 5 across 1\/9/)).toHaveLength(3);
    expect(screen.getAllByText(/Complete gross: 36/)).toHaveLength(1);
    expect(screen.getAllByText(/Incomplete — no final gross/)).toHaveLength(3);
  });
  it('renders all eight roster cards in their saved group order, never reorders them by gross', async () => {
    const client = fakeScores();
    const template = fictionalRoundScores.cards[0];
    if (!template) throw new Error('Missing fictional card');
    const cards = Array.from({ length: 8 }, (_, index) => ({
      ...template, playerId: fictionalId(index + 1), displayName: `Fictional Player ${String(index + 1)}`,
    }));
    vi.mocked(client.load).mockResolvedValue({
      ...fictionalRoundScores, cards,
      groups: [{ number: 1, playerIds: [fictionalId(3), fictionalId(1), fictionalId(7), fictionalId(2)] },
        { number: 2, playerIds: [fictionalId(8), fictionalId(4), fictionalId(6), fictionalId(5)] }],
    });
    mount(client);
    await loaded();
    expect(screen.getAllByRole('article').map((card) => card.getAttribute('aria-label'))).toEqual(
      [3, 1, 7, 2, 8, 4, 6, 5].map((number) => `Fictional Player ${String(number)} scorecard`),
    );
    expect(screen.getAllByRole('form')).toHaveLength(72);
  });
  it('keeps blank and invalid numeric drafts unsaved; saves first and subsequent holes with their acknowledged card revisions', async () => {
    const { client } = mount();
    await loaded();
    const user = userEvent.setup();
    await user.selectOptions(hole().getByRole('combobox'), 'strokes');
    expect(hole().getByRole('button', { name: 'Save hole 1' })).toBeDisabled();
    expect(hole().getByText(/blank is not zero/)).toBeVisible();
    await user.type(hole().getByRole('textbox'), '0');
    expect(hole().getByRole('button', { name: 'Save hole 1' })).toBeDisabled();
    await user.clear(hole().getByRole('textbox'));
    await user.type(hole().getByRole('textbox'), '4');
    expect(hole().getByText('Saved: Unplayed')).toBeVisible();
    await user.click(hole().getByRole('button', { name: 'Save hole 1' }));
    await waitFor(() => { expect(hole().getByText('Saved: 4 strokes')).toBeVisible(); });
    expect(hole().queryByText(/Local draft/)).not.toBeInTheDocument();
    await enterStrokes(user, 2, '5');
    await user.click(hole(2).getByRole('button', { name: 'Save hole 2' }));
    await waitFor(() => { expect(hole(2).getByText('Saved: 5 strokes')).toBeVisible(); });
    const calls = vi.mocked(client.save).mock.calls;
    expect(calls[0]?.[5]).toBeNull();
    expect(calls[1]?.[5]).toBe('card-v2');
    expect(calls[1]?.[6]).not.toBe(calls[0]?.[6]);
    expect(screen.getByText(/Saved numeric strokes: 9 across 2\/9/)).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Refresh saved round' }));
    expect(await screen.findByText(/Saved round refreshed/)).toBeVisible();
    expect(hole().getByText('Saved: 4 strokes')).toBeVisible();
    expect(hole(2).getByText('Saved: 5 strokes')).toBeVisible();
  });
  it.each(['picked-up', 'did-not-finish', 'unplayed'] as const)('saves explicit %s dispositions, including clearing a persisted score', async (kind) => {
    const client = fakeScores();
    vi.mocked(client.load).mockResolvedValue(scoreResult().round);
    mount(client);
    await loaded();
    const user = userEvent.setup();
    await user.selectOptions(hole().getByRole('combobox'), kind);
    expect(hole().queryByRole('textbox')).not.toBeInTheDocument();
    await user.click(hole().getByRole('button', { name: 'Save hole 1' }));
    await waitFor(() => { expect(client.save).toHaveBeenCalledOnce(); });
    expect(vi.mocked(client.save).mock.calls[0]?.[4]).toEqual({ kind });
    expect(vi.mocked(client.save).mock.calls[0]?.[5]).toBe('card-v2');
    await screen.findByText(/Save acknowledged/);
    expect(hole().queryByText(/Local draft/)).not.toBeInTheDocument();
  });
  it('retains failed values and request IDs on timeout-after-save, retries idempotently and gives explicit edits new IDs', async () => {
    const client = fakeScores();
    vi.mocked(client.save).mockRejectedValueOnce(new Error('Timed out after the server may have saved.'));
    mount(client);
    await loaded();
    const user = userEvent.setup();
    await enterStrokes(user);
    await enterStrokes(user, 2, '6');
    await user.click(hole().getByRole('button', { name: 'Save hole 1' }));
    await screen.findByRole('alert');
    expect(hole().getByRole('textbox')).toHaveValue('4');
    expect(hole(2).getByRole('textbox')).toHaveValue('6');
    const first = vi.mocked(client.save).mock.calls[0];
    expect(hole().getByText(`Request ID: ${first?.[6] ?? ''}`)).toBeVisible();
    await user.click(hole().getByRole('button', { name: 'Save hole 1' }));
    await screen.findByText(/Save acknowledged/);
    expect(vi.mocked(client.save).mock.calls[1]?.[6]).toBe(first?.[6]);
    expect(hole(2).getByText(/Local draft/)).toBeVisible();
    await user.clear(hole().getByRole('textbox'));
    await user.type(hole().getByRole('textbox'), '4');
    await user.click(hole().getByRole('button', { name: 'Save hole 1' }));
    await waitFor(() => { expect(client.save).toHaveBeenCalledTimes(3); });
    expect(vi.mocked(client.save).mock.calls[2]?.[6]).not.toBe(first?.[6]);
  });
  it('preserves local overlays when manually refreshed, and requires refresh + explicit conflict review before retry', async () => {
    const client = fakeScores();
    vi.mocked(client.save).mockRejectedValueOnce(new EventChangedError('This card changed. Refresh and review.'));
    const latest = scoreResult({ ...fictionalChange, after: { kind: 'strokes', strokes: 7 } }).round;
    mount(client);
    await loaded();
    const user = userEvent.setup();
    await enterStrokes(user);
    await user.click(hole().getByRole('button', { name: 'Save hole 1' }));
    await waitFor(() => { expect(hole().getByRole('alert')).toBeVisible(); });
    const review = hole().getByRole('button', { name: /I reviewed saved vs draft/ });
    expect(review).toBeDisabled();
    expect(hole().getByRole('button', { name: 'Save hole 1' })).toBeDisabled();
    vi.mocked(client.load).mockResolvedValueOnce(latest);
    await user.click(screen.getByRole('button', { name: 'Refresh saved round' }));
    await waitFor(() => { expect(review).toBeEnabled(); });
    expect(hole().getByText('Saved: 7 strokes')).toBeVisible();
    expect(hole().getByRole('textbox')).toHaveValue('4');
    expect(hole().getByRole('button', { name: 'Save hole 1' })).toBeDisabled();
    await user.click(review);
    await user.click(hole().getByRole('button', { name: 'Save hole 1' }));
    await screen.findByText(/Save acknowledged/);
    const calls = vi.mocked(client.save).mock.calls;
    expect(calls[1]?.[5]).toBe('card-v2');
    expect(calls[1]?.[6]).not.toBe(calls[0]?.[6]);
  });
  it('does not silently clear an uncertain draft merely because a refresh shows the same numeric value', async () => {
    const client = fakeScores();
    vi.mocked(client.save).mockRejectedValueOnce(new Error('Network failed after save.'));
    mount(client);
    await loaded();
    const user = userEvent.setup();
    await enterStrokes(user);
    await user.click(hole().getByRole('button', { name: 'Save hole 1' }));
    await screen.findByRole('alert');
    vi.mocked(client.load).mockResolvedValueOnce(scoreResult().round);
    await user.click(screen.getByRole('button', { name: 'Refresh saved round' }));
    await screen.findByText(/Saved round refreshed/);
    expect(hole().getByText('Saved: 4 strokes')).toBeVisible();
    expect(hole().getByText(/Local draft: 4 strokes/)).toBeVisible();
    await user.click(hole().getByRole('button', { name: 'Save hole 1' }));
    await screen.findByText(/Save acknowledged/);
    const calls = vi.mocked(client.save).mock.calls;
    expect(calls[1]?.[5]).toBeNull();
    expect(calls[1]?.[6]).toBe(calls[0]?.[6]);
  });
  it('gives an explicit edit after an uncertain request a new ID, even if the owner types the same value again', async () => {
    const client = fakeScores();
    vi.mocked(client.save).mockRejectedValueOnce(new Error('Uncertain network outcome.'));
    mount(client);
    await loaded();
    const user = userEvent.setup();
    await enterStrokes(user);
    await user.click(hole().getByRole('button', { name: 'Save hole 1' }));
    await screen.findByRole('alert');
    const first = vi.mocked(client.save).mock.calls[0]?.[6];
    await user.clear(hole().getByRole('textbox'));
    await user.type(hole().getByRole('textbox'), '4');
    await user.click(hole().getByRole('button', { name: 'Save hole 1' }));
    await screen.findByText(/Save acknowledged/);
    expect(vi.mocked(client.save).mock.calls[1]?.[6]).not.toBe(first);
  });
  it('requires a new conflict review when a later refresh changes the reviewed base revision', async () => {
    const client = fakeScores();
    vi.mocked(client.save).mockRejectedValueOnce(new EventChangedError('Changed.'));
    mount(client);
    await loaded();
    const user = userEvent.setup();
    await enterStrokes(user);
    await user.click(hole().getByRole('button', { name: 'Save hole 1' }));
    await waitFor(() => { expect(hole().getByRole('alert')).toBeVisible(); });
    vi.mocked(client.load).mockResolvedValueOnce(scoreResult().round);
    await user.click(screen.getByRole('button', { name: 'Refresh saved round' }));
    const review = hole().getByRole('button', { name: /I reviewed saved vs draft/ });
    await waitFor(() => { expect(review).toBeEnabled(); });
    await user.click(review);
    expect(hole().getByRole('button', { name: 'Save hole 1' })).toBeEnabled();
    const latest = scoreResult().round;
    vi.mocked(client.load).mockResolvedValueOnce({
      ...latest, cards: latest.cards.map((card) => card.playerId === fictionalChange.playerId ? { ...card, etag: 'card-v3' } : card),
    });
    await user.click(screen.getByRole('button', { name: 'Refresh saved round' }));
    await waitFor(() => { expect(review).toBeEnabled(); });
    expect(hole().getByRole('button', { name: 'Save hole 1' })).toBeDisabled();
    expect(hole().getByRole('textbox')).toHaveValue('4');
  });
  it('serializes writes and manual reads; accepts an audit ack even when the projection already contains a later correction', async () => {
    const client = fakeScores();
    let finish: ((result: ScoreWriteResult) => void) | undefined;
    vi.mocked(client.save).mockImplementationOnce((_eventId, _roundId, playerId, holeNumber, score, etag, id) => new Promise((resolve) => {
      finish = () => { resolve({
        change: { ...fictionalChange, playerId, holeNumber, after: score, expectedEtag: etag, id },
        round: scoreResult({ ...fictionalChange, after: { kind: 'strokes', strokes: 8 } }).round,
      }); };
    }));
    mount(client);
    await loaded();
    const user = userEvent.setup();
    await enterStrokes(user);
    await user.click(hole().getByRole('button', { name: 'Save hole 1' }));
    expect(screen.getByRole('button', { name: 'Refresh saved round' })).toBeDisabled();
    expect(hole().getByRole('button', { name: 'Save hole 1' })).toBeDisabled();
    expect(client.load).toHaveBeenCalledOnce();
    await act(async () => { finish?.(scoreResult()); await Promise.resolve(); });
    expect(hole().getByText('Saved: 8 strokes')).toBeVisible();
    expect(screen.getByText(/Save acknowledged for Fictional Player 1, hole 1: Unplayed → 4 strokes/)).toBeVisible();
    expect(hole().queryByText(/Local draft/)).not.toBeInTheDocument();
    expect(client.save).toHaveBeenCalledOnce();
  });
  it('shows visible old/new/actor/time audit history and fetches subsequent pages', async () => {
    const client = fakeScores();
    vi.mocked(client.history).mockResolvedValueOnce({ changes: [fictionalChange], continuationToken: 'fictional-next' })
      .mockResolvedValueOnce({ changes: [{ ...fictionalChange, id: fictionalId(402), before: fictionalChange.after, after: { kind: 'picked-up' } }] });
    mount(client);
    await loaded();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Load audit history for Fictional Player 1' }));
    const history = await screen.findByRole('region', { name: 'Fictional Player 1 audit history' });
    expect(history).toHaveTextContent('Unplayed → 4 strokes');
    expect(history).toHaveTextContent(fictionalChange.recordedBy.objectId);
    expect(history).toHaveTextContent(fictionalChange.recordedAt);
    await user.click(screen.getByRole('button', { name: 'More history for Fictional Player 1' }));
    await waitFor(() => { expect(within(history).getAllByRole('listitem')).toHaveLength(2); });
    expect(vi.mocked(client.history).mock.calls[1]?.[4]).toBe('fictional-next');
  });
  it('keeps archived owners read-only, and never substitutes demo cards on denied owner reads', async () => {
    const client = fakeScores();
    vi.mocked(client.load).mockResolvedValueOnce({ ...fictionalRoundScores, eventStatus: 'archived' });
    const { unmount } = mount(client);
    await loaded();
    expect(hole().getByRole('combobox')).toBeDisabled();
    expect(screen.getByText(/Archived event: owner read-only/)).toBeVisible();
    unmount();
    vi.mocked(client.load).mockRejectedValueOnce(new Error('You do not have permission for this operation.'));
    mount(client);
    expect(await screen.findByRole('alert')).toHaveTextContent('permission');
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
    expect(client.save).not.toHaveBeenCalled();
  });
  it('expires the session explicitly and aborts unmounted private operations without accepting late responses', async () => {
    const client = fakeScores();
    vi.mocked(client.load).mockRejectedValueOnce(new SessionExpiredError('Sign in again.'));
    const expired = mount(client);
    await screen.findByRole('alert');
    expect(expired.onSessionExpired).toHaveBeenCalledWith('Sign in again.');
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
    expired.unmount();
    let finish: ((round: RoundScores) => void) | undefined;
    vi.mocked(client.load).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const second = mount(client);
    const call = vi.mocked(client.load).mock.calls.at(-1);
    second.unmount();
    expect(call?.[2].aborted).toBe(true);
    await act(async () => { finish?.(fictionalRoundScores); await Promise.resolve(); });
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
  });
});
