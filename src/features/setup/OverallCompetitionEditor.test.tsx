import { useState } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { fictionalId, fictionalWorkspace } from '../../client/catalog.test-support';
import { fakeScores, fictionalRoundScores } from '../../client/scoring.test-support';
import { EventChangedError, SessionExpiredError } from '../../client/events';
import { PrivateRequestError } from '../../client/private-request';
import type { RoundScores } from '../../domain/scoring';
import type { EventSetupInput, EventWorkspace } from '../../domain/setup';
import { OverallCompetitionEditor } from './OverallCompetitionEditor';
import { inputFrom } from './setup-draft';

const gameId = fictionalId(501);
const gameScores: RoundScores = { ...fictionalRoundScores, games: {
  configuration: { eventId: fictionalWorkspace.event.id, roundId: fictionalId(70), etag: 'games-v1', games: [{
    id: gameId, name: 'Fictional custom points', basis: 'gross', preset: 'modified', handicapAllowancePercent: 95,
    points: { rows: [{ scoreToPar: 0, points: 1 }], betterScorePoints: 8, worseScorePoints: -2 },
  }] }, results: [],
} };
function deferred<T>() {
  let resolve: (value: T) => void = () => { throw new Error('Not initialized'); };
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
}
function mount(input: EventSetupInput = inputFrom(fictionalWorkspace), workspace: EventWorkspace = fictionalWorkspace) {
  const scores = fakeScores();
  vi.mocked(scores.load).mockResolvedValue(gameScores);
  const onChange = vi.fn();
  const onDenied = vi.fn();
  function Harness() {
    const [draft, setDraft] = useState(input);
    return <OverallCompetitionEditor workspace={workspace} draft={draft} scores={scores} disabled={false}
      onDenied={onDenied} onChange={(overallCompetition) => {
        onChange(overallCompetition); setDraft({ ...draft, overallCompetition });
      }} />;
  }
  return { ...render(<Harness />), scores, onChange, onDenied };
}
describe('optional overall competition editor', () => {
  it('defaults off without score prefetch; enables labelled individual credit and sends explicit null when disabled', async () => {
    const view = mount();
    expect(screen.getByRole('checkbox', { name: 'Enable overall leaderboard' })).not.toBeChecked();
    expect(view.scores.load).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('checkbox'));
    expect(view.onChange).toHaveBeenLastCalledWith({ kind: 'stableford', credit: 'individual', roundGames: [] });
    const select = await screen.findByRole('option', { name: 'Fictional custom points' });
    expect(select).toBeInTheDocument();
    expect(screen.getByLabelText(/Round 1:.*game/)).toHaveValue('');
    await userEvent.click(screen.getByRole('checkbox'));
    expect(view.onChange).toHaveBeenLastCalledWith(null);
  });
  it('supports gross and net with new 95% allowance and preserves deliberate credit and selected saved game', async () => {
    const view = mount();
    const user = userEvent.setup();
    await user.click(screen.getByRole('checkbox'));
    await screen.findByRole('option', { name: 'Fictional custom points' });
    await user.selectOptions(screen.getByLabelText('Event points credit'), 'team');
    await user.selectOptions(screen.getByLabelText(/Round 1:.*game/), gameId);
    expect(view.onChange).toHaveBeenLastCalledWith({
      kind: 'stableford', credit: 'team', roundGames: [{ roundId: fictionalId(70), gameId }],
    });
    await user.selectOptions(screen.getByLabelText('Competition'), 'stroke-play');
    expect(screen.getByLabelText('Stroke basis')).toHaveValue('gross');
    expect(screen.queryByLabelText('Event points credit')).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Stroke basis'), 'net');
    const allowance = screen.getByLabelText('Net handicap allowance (%)');
    expect(allowance).toHaveValue(95);
    await user.clear(allowance);
    await user.type(allowance, '90');
    expect(view.onChange).toHaveBeenLastCalledWith({ kind: 'stroke-play', basis: 'net', handicapAllowancePercent: 90 });
    expect(view.scores.load).toHaveBeenCalledOnce();
  });
  it('lets the owner explicitly repair obsolete round bindings without rewriting current selections or credit', async () => {
    const current = { roundId: fictionalId(70), gameId };
    const view = mount({ ...inputFrom(fictionalWorkspace), overallCompetition: {
      kind: 'stableford', credit: 'team', roundGames: [current, { roundId: fictionalId(71), gameId: fictionalId(502) }],
    } });
    await userEvent.click(screen.getByRole('button', { name: 'Remove obsolete round selections' }));
    expect(view.onChange).toHaveBeenLastCalledWith({ kind: 'stableford', credit: 'team', roundGames: [current] });
  });
  it('keeps saved selections during loading and labels missing games without exposing IDs or fetching unsaved rounds', async () => {
    const pending = deferred<RoundScores>();
    const scores = fakeScores();
    vi.mocked(scores.load).mockReturnValue(pending.promise);
    const firstRound = inputFrom(fictionalWorkspace).rounds[0];
    if (!firstRound) throw new Error('Missing fixture round');
    const draft: EventSetupInput = { ...inputFrom(fictionalWorkspace), overallCompetition: {
      kind: 'stableford', credit: 'team', roundGames: [{ roundId: fictionalId(70), gameId: fictionalId(502) }],
    }, rounds: [...inputFrom(fictionalWorkspace).rounds, { ...firstRound, id: fictionalId(71), name: 'Fictional new round' }] };
    const props = { workspace: fictionalWorkspace, draft, scores, disabled: false, onChange: vi.fn(), onDenied: vi.fn() };
    const view = render(<OverallCompetitionEditor {...props} />);
    expect(screen.getByLabelText(/Round 1:.*game/)).toHaveValue(fictionalId(502));
    expect(screen.getByRole('option', { name: 'Saved selection — awaiting game names' })).toBeVisible();
    expect(screen.getByLabelText('Round 2: Fictional new round game')).toBeDisabled();
    expect(screen.getByText(/Save this new round/)).toBeVisible();
    await act(async () => { pending.resolve(gameScores); await Promise.resolve(); });
    expect(screen.getByRole('option', { name: /Selected game missing/ })).toBeVisible();
    expect(document.body.textContent).not.toContain(fictionalId(502));
    expect(scores.load).toHaveBeenCalledExactlyOnceWith(fictionalWorkspace.event.id, fictionalId(70), expect.any(AbortSignal));
    view.unmount();
  });
  it('bounds option reads to three and ignores stale reads across modes/workspaces/clients', async () => {
    const pending = deferred<RoundScores>();
    const scores = fakeScores();
    vi.mocked(scores.load).mockReturnValue(pending.promise);
    const first = fictionalWorkspace.rounds[0];
    if (!first) throw new Error('Missing fixture round');
    const workspace = { ...fictionalWorkspace, rounds: Array.from({ length: 8 }, (_, index) => ({
      ...first, id: fictionalId(70 + index), name: `Fictional round ${String(index + 1)}`,
    })) };
    const draft: EventSetupInput = { ...inputFrom(workspace), overallCompetition: { kind: 'stableford', credit: 'individual', roundGames: [] } };
    const props = { workspace, draft, scores, disabled: false, onChange: vi.fn(), onDenied: vi.fn() };
    const view = render(<OverallCompetitionEditor {...props} />);
    expect(scores.load).toHaveBeenCalledTimes(3);
    const signal = vi.mocked(scores.load).mock.calls[0]?.[2];
    view.rerender(<OverallCompetitionEditor {...props} draft={{ ...draft, overallCompetition: { kind: 'stroke-play', basis: 'gross' } }} />);
    expect(signal?.aborted).toBe(true);
    await act(async () => { pending.resolve(gameScores); await Promise.resolve(); });
    expect(scores.load).toHaveBeenCalledTimes(3);
    expect(screen.queryByText('Fictional custom points')).not.toBeInTheDocument();
    const next = fakeScores();
    vi.mocked(next.load).mockResolvedValue(gameScores);
    view.rerender(<OverallCompetitionEditor {...props} workspace={{ ...workspace, etag: 'new-version' }} scores={next} />);
    await waitFor(() => { expect(next.load).toHaveBeenCalledTimes(8); });
    expect(props.onChange).not.toHaveBeenCalled();
  });
  it.each([
    [new PrivateRequestError(403, 'Denied'), false],
    [new PrivateRequestError(404, 'Missing'), false],
    [new PrivateRequestError(401, 'Expired'), true],
    [new SessionExpiredError('Sign in'), true],
  ] as const)('locks protected setup on %s and distinguishes actual expiry', async (failure, expired) => {
    const view = mount({ ...inputFrom(fictionalWorkspace), overallCompetition: { kind: 'stableford', credit: 'individual', roundGames: [] } });
    vi.mocked(view.scores.load).mockRejectedValue(failure);
    await screen.findByRole('option', { name: 'Fictional custom points' });
    await userEvent.click(screen.getByRole('button', { name: 'Retry saved games' }));
    await waitFor(() => { expect(view.onDenied).toHaveBeenCalledWith(failure, expired); });
  });
  it.each([new EventChangedError('Snapshot changed'), new Error('Service down'), new PrivateRequestError(429, 'Rate limited')])(
    'retains selections on ordinary/conflict option failures: %s', async (failure) => {
      const view = mount({ ...inputFrom(fictionalWorkspace), overallCompetition: {
        kind: 'stableford', credit: 'team', roundGames: [{ roundId: fictionalId(70), gameId }],
      } });
      await screen.findByRole('option', { name: 'Fictional custom points' });
      vi.mocked(view.scores.load).mockRejectedValueOnce(failure);
      await userEvent.click(screen.getByRole('button', { name: 'Retry saved games' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('draft is preserved');
      expect(screen.getByLabelText(/Round 1:.*game/)).toHaveValue(gameId);
      expect(view.onDenied).not.toHaveBeenCalled();
      expect(view.onChange).not.toHaveBeenCalled();
    });
});
