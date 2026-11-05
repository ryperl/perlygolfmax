import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { fakeSetup, fictionalId, fictionalWorkspace } from '../client/catalog.test-support';
import type { EventWorkspace } from '../domain/setup';
import { PrivateRequestError } from '../client/private-request';
import { SessionExpiredError } from '../client/events';
import { SavedEventPage } from './SavedEventPage';
import { fakeScores, fictionalRoundScores, scoreResult } from '../client/scoring.test-support';
import type { RoundScores } from '../domain/scoring';

function mount() {
  const client = fakeSetup();
  vi.mocked(client.load).mockResolvedValue(fictionalWorkspace);
  const props = { client, eventId: fictionalWorkspace.event.id, view: 'overview' as const, onSessionExpired: vi.fn() };
  return { ...props, ...render(<SavedEventPage {...props} />), props };
}
describe('saved event view loading', () => {
  it('uses the owner workspace once for the selected event and retains its real snapshot across tabs', async () => {
    const view = mount();
    expect(await screen.findByRole('heading', { name: fictionalWorkspace.event.name })).toBeVisible();
    expect(view.client.load).toHaveBeenCalledWith(fictionalWorkspace.event.id, expect.any(AbortSignal));
    view.rerender(<SavedEventPage {...view.props} view="rounds" />);
    expect(screen.getByRole('heading', { level: 1, name: 'Rounds' })).toBeVisible();
    expect(screen.getByText('Fictional Meadows')).toBeVisible();
    view.rerender(<SavedEventPage {...view.props} view="group" />);
    expect(screen.getByRole('heading', { level: 1, name: 'The Group' })).toBeVisible();
    expect(view.client.load).toHaveBeenCalledOnce();
    expect(view.client.save).not.toHaveBeenCalled();
  });

  function deferred<T>() {
    let resolve: (value: T) => void = () => { throw new Error('Promise not initialized.'); };
    let reject: (failure: unknown) => void = () => { throw new Error('Promise not initialized.'); };
    const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
  }
  function progressMount(workspace: EventWorkspace = fictionalWorkspace) {
    const client = fakeSetup();
    const scores = fakeScores();
    vi.mocked(client.load).mockResolvedValue(workspace);
    const props = { client, scores, eventId: workspace.event.id, view: 'overview' as const, onSessionExpired: vi.fn() };
    return { ...render(<SavedEventPage {...props} />), props, client, scores };
  }
  const savedEntries = scoreResult().round;
  const allEntries: RoundScores = {
    ...savedEntries,
    cards: savedEntries.cards.map((card) => ({
      ...card, etag: 'card-v2', updatedAt: savedEntries.lastUpdatedAt,
      holes: card.holes.map((hole) => ({ ...hole, score: { kind: 'picked-up' } })),
    })),
  };
  describe('saved event entry progress reads', () => {
    it('loads once per workspace, retains summaries across tabs, and refreshes saved partial, complete and cleared entries', async () => {
      const view = progressMount();
      expect(await screen.findByText('Saved entry progress: No scores yet')).toBeVisible();
      expect(view.scores.load).toHaveBeenCalledWith(fictionalWorkspace.event.id, fictionalRoundScores.roundId, expect.any(AbortSignal));
      view.rerender(<SavedEventPage {...view.props} view="rounds" />);
      view.rerender(<SavedEventPage {...view.props} view="group" />);
      expect(view.scores.load).toHaveBeenCalledOnce();
      for (const [value, status] of [
        [savedEntries, 'In progress'], [allEntries, 'Entries complete'],
        [{ ...savedEntries, cards: savedEntries.cards.map((card) => ({
          ...card, holes: card.holes.map((hole) => ({ ...hole, score: { kind: 'unplayed' as const } })),
        })) }, 'No scores yet'],
      ] as const) {
        vi.mocked(view.scores.load).mockResolvedValueOnce(value);
        await userEvent.setup().click(screen.getByRole('button', { name: 'Refresh event' }));
        expect(await screen.findByText(`Saved entry progress: ${status}`)).toBeVisible();
      }
      expect(view.scores.load).toHaveBeenCalledTimes(4);
      expect(view.scores.save).not.toHaveBeenCalled();
      expect(view.client.save).not.toHaveBeenCalled();
    });

    it('does not request scoring for legacy unadmitted members and rejects archived member projections', async () => {
      const member = { ...fictionalWorkspace, event: { ...fictionalWorkspace.event, role: 'member' as const } };
      const view = progressMount(member);
      expect(await screen.findByText('Entry progress requires approved player access.')).toBeVisible();
      expect(view.scores.load).not.toHaveBeenCalled();
      vi.mocked(view.client.load).mockResolvedValueOnce({ ...member, event: { ...member.event, status: 'archived' } });
      await userEvent.setup().click(screen.getByRole('button', { name: 'Refresh event' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('Archived events are available to the event owner only.');
      expect(view.scores.load).not.toHaveBeenCalled();
    });

    it('reads archived owner entries without writes and handles an absent scores client honestly', async () => {
      const archived = { ...fictionalWorkspace, event: { ...fictionalWorkspace.event, status: 'archived' as const } };
      const view = progressMount(archived);
      vi.mocked(view.scores.load).mockResolvedValue({ ...fictionalRoundScores, eventStatus: 'archived',
        permissions: { role: 'owner', writePlayerIds: [], canManageGames: false } });
      expect(await screen.findByText('Saved entry progress: No scores yet')).toBeVisible();
      expect(view.scores.save).not.toHaveBeenCalled();
      view.rerender(<SavedEventPage client={view.client} eventId={view.props.eventId} view="overview" onSessionExpired={view.props.onSessionExpired} />);
      expect(screen.getByText('Progress unavailable. Use Refresh event to retry.')).toBeVisible();
      expect(screen.queryByText('Saved entry progress: No scores yet')).not.toBeInTheDocument();
    });

    it('shows loading rather than zero, ignores replaced client results, and calls the latest expiry callback', async () => {
      const view = progressMount();
      await screen.findByText('Saved entry progress: No scores yet');
      const old = deferred<RoundScores>();
      const replaced = fakeScores();
      vi.mocked(replaced.load).mockReturnValue(old.promise);
      view.rerender(<SavedEventPage {...view.props} scores={replaced} />);
      expect(screen.getByText('Loading entry progress…')).toBeVisible();
      expect(screen.queryByText('Saved entry progress: No scores yet')).not.toBeInTheDocument();
      const latest = fakeScores();
      const pending = deferred<RoundScores>();
      vi.mocked(latest.load).mockReturnValue(pending.promise);
      const onSessionExpired = vi.fn();
      view.rerender(<SavedEventPage {...view.props} scores={latest} />);
      view.rerender(<SavedEventPage {...view.props} scores={latest} onSessionExpired={onSessionExpired} />);
      expect(vi.mocked(replaced.load).mock.calls[0]?.[2].aborted).toBe(true);
      await act(async () => { old.resolve(allEntries); await old.promise; });
      expect(screen.queryByText('Saved entry progress: Entries complete')).not.toBeInTheDocument();
      await act(async () => { pending.reject(new SessionExpiredError('Sign in again.')); await pending.promise.catch(() => {}); });
      expect(await screen.findByRole('alert')).toHaveTextContent('Sign in again.');
      expect(screen.queryByRole('heading', { name: fictionalWorkspace.event.name })).not.toBeInTheDocument();
      expect(screen.queryByRole('link', { name: 'Configure event' })).not.toBeInTheDocument();
      expect(onSessionExpired).toHaveBeenCalledWith('Sign in again.');
      expect(view.props.onSessionExpired).not.toHaveBeenCalled();
    });

    it('aborts pending scores on refresh, event replacement and unmount, ignoring late success and expiry', async () => {
      const view = progressMount();
      await screen.findByText('Saved entry progress: No scores yet');
      const old = deferred<RoundScores>();
      vi.mocked(view.scores.load).mockReturnValueOnce(old.promise);
      await userEvent.setup().click(screen.getByRole('button', { name: 'Refresh event' }));
      await screen.findByText('Loading entry progress…');
      const oldSignal = vi.mocked(view.scores.load).mock.calls.at(-1)?.[2];
      vi.mocked(view.scores.load).mockResolvedValueOnce(savedEntries);
      await userEvent.setup().click(screen.getByRole('button', { name: 'Refresh event' }));
      await screen.findByText('Saved entry progress: In progress');
      expect(oldSignal?.aborted).toBe(true);
      await act(async () => { old.resolve(allEntries); await old.promise; });
      expect(screen.queryByText('Saved entry progress: Entries complete')).not.toBeInTheDocument();
      const stale = deferred<RoundScores>();
      vi.mocked(view.scores.load).mockReturnValueOnce(stale.promise);
      await userEvent.setup().click(screen.getByRole('button', { name: 'Refresh event' }));
      await screen.findByText('Loading entry progress…');
      const staleSignal = vi.mocked(view.scores.load).mock.calls.at(-1)?.[2];
      const next = { ...fictionalWorkspace, event: { ...fictionalWorkspace.event, id: fictionalId(99), name: 'Fictional Next Event' } };
      vi.mocked(view.client.load).mockResolvedValueOnce(next);
      vi.mocked(view.scores.load).mockResolvedValueOnce({ ...fictionalRoundScores, eventId: next.event.id });
      view.rerender(<SavedEventPage {...view.props} eventId={next.event.id} />);
      await screen.findByText('Saved entry progress: No scores yet');
      expect(staleSignal?.aborted).toBe(true);
      await act(async () => { stale.reject(new SessionExpiredError('Stale expiry')); await stale.promise.catch(() => {}); });
      expect(view.props.onSessionExpired).not.toHaveBeenCalled();
      const exit = deferred<RoundScores>();
      vi.mocked(view.scores.load).mockReturnValueOnce(exit.promise);
      await userEvent.setup().click(screen.getByRole('button', { name: 'Refresh event' }));
      await screen.findByText('Loading entry progress…');
      const exitSignal = vi.mocked(view.scores.load).mock.calls.at(-1)?.[2];
      view.unmount();
      expect(exitSignal?.aborted).toBe(true);
      await act(async () => { exit.resolve(allEntries); await exit.promise; });
    });

    it('replaces the workspace and saved round list without letting an old round reappear', async () => {
      const view = progressMount();
      await screen.findByText('Saved entry progress: No scores yet');
      const pending = deferred<RoundScores>();
      vi.mocked(view.scores.load).mockReturnValueOnce(pending.promise);
      await userEvent.setup().click(screen.getByRole('button', { name: 'Refresh event' }));
      await screen.findByText('Loading entry progress…');
      const oldSignal = vi.mocked(view.scores.load).mock.calls.at(-1)?.[2];
      const replacement = fakeSetup();
      const first = fictionalWorkspace.rounds[0];
      if (!first) throw new Error('Missing fictional round.');
      const nextRound = { ...first, id: fictionalId(71), name: 'Fictional replacement round' };
      vi.mocked(replacement.load).mockResolvedValue({ ...fictionalWorkspace, rounds: [nextRound] });
      vi.mocked(view.scores.load).mockResolvedValueOnce({ ...savedEntries, roundId: nextRound.id });
      view.rerender(<SavedEventPage {...view.props} client={replacement} />);
      await screen.findByText('Saved entry progress: In progress');
      expect(oldSignal?.aborted).toBe(true);
      expect(screen.queryByRole('heading', { name: first.name })).not.toBeInTheDocument();
      expect(screen.getByRole('heading', { name: nextRound.name })).toBeVisible();
      await act(async () => { pending.resolve(allEntries); await pending.promise; });
      expect(screen.queryByText('Saved entry progress: Entries complete')).not.toBeInTheDocument();
      expect(screen.getByText('Saved entry progress: In progress')).toBeVisible();
    });

    it('does not restore summaries when a concurrent round resolves after access denial', async () => {
      const first = fictionalWorkspace.rounds[0];
      if (!first) throw new Error('Missing fictional round.');
      const client = fakeSetup();
      vi.mocked(client.load).mockResolvedValue({
        ...fictionalWorkspace, rounds: [first, { ...first, id: fictionalId(71), name: 'Fictional second round' }],
      });
      const scores = fakeScores();
      const denied = deferred<RoundScores>();
      const late = deferred<RoundScores>();
      vi.mocked(scores.load).mockReturnValueOnce(denied.promise).mockReturnValueOnce(late.promise);
      render(<SavedEventPage client={client} scores={scores} eventId={fictionalWorkspace.event.id} view="overview" onSessionExpired={vi.fn()} />);
      await waitFor(() => { expect(scores.load).toHaveBeenCalledTimes(2); });
      await act(async () => { denied.reject(new PrivateRequestError(403, 'Access denied')); await denied.promise.catch(() => {}); });
      expect(vi.mocked(scores.load).mock.calls[1]?.[2].aborted).toBe(true);
      await act(async () => { late.resolve({ ...allEntries, roundId: fictionalId(71) }); await late.promise; });
      expect(screen.queryByText('Saved entry progress: Entries complete')).not.toBeInTheDocument();
      expect(screen.getByRole('alert')).toHaveTextContent('Access denied');
      expect(screen.queryByRole('heading', { name: fictionalWorkspace.event.name })).not.toBeInTheDocument();
      expect(screen.queryByRole('link', { name: 'Configure event' })).not.toBeInTheDocument();
    });

    it.each([403, 404, 401])('clears all protected progress on authoritative denial %s and ignores sibling responses', async (status) => {
      const first = fictionalWorkspace.rounds[0];
      if (!first) throw new Error('Missing fictional round.');
      const second = { ...first, id: fictionalId(71), name: 'Fictional second round' };
      const client = fakeSetup();
      const third = { ...first, id: fictionalId(72), name: 'Fictional third round' };
      vi.mocked(client.load).mockResolvedValue({ ...fictionalWorkspace, rounds: [first, second, third] });
      const scores = fakeScores();
      const pending = deferred<RoundScores>();
      const late = deferred<RoundScores>();
      vi.mocked(scores.load).mockResolvedValueOnce(allEntries).mockReturnValueOnce(pending.promise).mockReturnValueOnce(late.promise);
      const onSessionExpired = vi.fn();
      render(<SavedEventPage client={client} scores={scores} eventId={fictionalWorkspace.event.id} view="overview" onSessionExpired={onSessionExpired} />);
      await screen.findByText('Saved entry progress: Entries complete');
      expect(screen.getByRole('heading', { name: fictionalWorkspace.event.name })).toBeVisible();
      expect(screen.getByRole('link', { name: 'Configure event' })).toBeVisible();
      await act(async () => { pending.reject(new PrivateRequestError(status, 'Access denied')); await pending.promise.catch(() => {}); });
      expect(screen.queryByText('Saved entry progress: Entries complete')).not.toBeInTheDocument();
      expect(screen.getByRole('alert')).toHaveTextContent('Access denied');
      expect(screen.queryByRole('heading', { name: fictionalWorkspace.event.name })).not.toBeInTheDocument();
      expect(screen.queryByRole('link', { name: 'Configure event' })).not.toBeInTheDocument();
      await act(async () => { late.resolve({ ...allEntries, roundId: third.id }); await late.promise; });
      expect(screen.queryByRole('region', { name: 'Saved entry progress' })).not.toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: fictionalWorkspace.event.name })).not.toBeInTheDocument();
      expect(onSessionExpired).toHaveBeenCalledTimes(status === 401 ? 1 : 0);
      vi.mocked(scores.load).mockImplementation((_eventId, roundId) => Promise.resolve({ ...fictionalRoundScores, roundId }));
      await userEvent.setup().click(screen.getByRole('button', { name: 'Refresh event' }));
      await waitFor(() => { expect(screen.getAllByText('Saved entry progress: No scores yet')).toHaveLength(3); });
      expect(screen.getByRole('heading', { name: fictionalWorkspace.event.name })).toBeVisible();
      expect(screen.getByRole('link', { name: 'Configure event' })).toBeVisible();
    });

    it('bounds round reads to three, preserves other summaries on network errors, and rejects mismatched projections', async () => {
      const first = fictionalWorkspace.rounds[0];
      if (!first) throw new Error('Missing fictional round.');
      const rounds = Array.from({ length: 5 }, (_, index) => ({ ...first, id: fictionalId(70 + index), name: `Fictional round ${String(index + 1)}` }));
      const pending = Array.from({ length: 5 }, () => deferred<RoundScores>());
      const scores = fakeScores();
      const client = fakeSetup();
      vi.mocked(client.load).mockResolvedValue({ ...fictionalWorkspace, rounds });
      vi.mocked(scores.load).mockImplementation((_eventId, roundId) => {
        const request = pending[rounds.findIndex((round) => round.id === roundId)];
        if (!request) throw new Error('Unexpected fictional round');
        return request.promise;
      });
      render(<SavedEventPage client={client} scores={scores} eventId={fictionalWorkspace.event.id} view="overview" onSessionExpired={vi.fn()} />);
      await waitFor(() => { expect(scores.load).toHaveBeenCalledTimes(3); });
      await act(async () => { pending[0]?.resolve(allEntries); await pending[0]?.promise; });
      await waitFor(() => { expect(scores.load).toHaveBeenCalledTimes(4); });
      await act(async () => { pending[1]?.reject(new Error('Network unavailable')); await pending[1]?.promise.catch(() => {}); });
      await waitFor(() => { expect(scores.load).toHaveBeenCalledTimes(5); });
      await act(async () => {
        pending[2]?.resolve({ ...fictionalRoundScores, roundId: fictionalId(72), cards: [] });
        pending[3]?.resolve({ ...fictionalRoundScores, roundId: fictionalId(73) });
        pending[4]?.resolve({ ...fictionalRoundScores, roundId: fictionalId(999) });
        await Promise.all(pending.slice(2).map((request) => request.promise));
      });
      expect(screen.getByText('Saved entry progress: Entries complete')).toBeVisible();
      expect(screen.getByText('Saved entry progress: No scores yet')).toBeVisible();
      expect(screen.getAllByText('Progress unavailable. Use Refresh event to retry.')).toHaveLength(3);
      expect(screen.queryByText('Loading entry progress…')).not.toBeInTheDocument();
    });
  });
  it('exposes initial failure and explicit retry without inventing demo event data', async () => {
    const client = fakeSetup();
    vi.mocked(client.load).mockRejectedValueOnce(new Error('Saved event unavailable.')).mockResolvedValueOnce(fictionalWorkspace);
    render(<SavedEventPage client={client} eventId={fictionalWorkspace.event.id} view="rounds" onSessionExpired={vi.fn()} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Saved event unavailable');
    expect(screen.queryByText('The Coastal Classic')).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Refresh event' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Rounds' })).toBeVisible();
    expect(client.load).toHaveBeenCalledTimes(2);
  });
  it('clears loaded private content when an explicit refresh reports access revoked', async () => {
    const view = mount();
    await screen.findByRole('heading', { name: fictionalWorkspace.event.name });
    vi.mocked(view.client.load).mockRejectedValueOnce(new PrivateRequestError(403, 'Owner access revoked.'));
    await userEvent.setup().click(screen.getByRole('button', { name: 'Refresh event' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Owner access revoked');
    expect(screen.queryByRole('heading', { name: fictionalWorkspace.event.name })).not.toBeInTheDocument();
    expect(view.onSessionExpired).not.toHaveBeenCalled();
  });
  it('does not expose the prior workspace while a replacement client is still loading', async () => {
    const view = mount();
    await screen.findByRole('heading', { name: fictionalWorkspace.event.name });
    const replacement = fakeSetup();
    let finish: ((workspace: EventWorkspace) => void) | undefined;
    const pending = new Promise<EventWorkspace>((resolve) => { finish = resolve; });
    vi.mocked(replacement.load).mockReturnValueOnce(pending);
    view.rerender(<SavedEventPage {...view.props} client={replacement} />);
    expect(screen.queryByRole('heading', { name: fictionalWorkspace.event.name })).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Loading saved event');
    await act(async () => { finish?.(fictionalWorkspace); await pending; });
    expect(screen.getByRole('heading', { name: fictionalWorkspace.event.name })).toBeVisible();
  });
  it('aborts a superseded event read and never renders its late response under another event', async () => {
    const client = fakeSetup();
    let finish: ((workspace: EventWorkspace) => void) | undefined;
    const old = new Promise<EventWorkspace>((resolve) => { finish = resolve; });
    const next = { ...fictionalWorkspace, event: { ...fictionalWorkspace.event, id: fictionalId(99), name: 'Fictional Second Event' } };
    vi.mocked(client.load).mockReturnValueOnce(old).mockResolvedValueOnce(next);
    const props = { client, view: 'overview' as const, onSessionExpired: vi.fn() };
    const { rerender } = render(<SavedEventPage {...props} key={fictionalWorkspace.event.id} eventId={fictionalWorkspace.event.id} />);
    rerender(<SavedEventPage {...props} key={next.event.id} eventId={next.event.id} />);
    expect(await screen.findByRole('heading', { name: next.event.name })).toBeVisible();
    expect(vi.mocked(client.load).mock.calls[0]?.[1].aborted).toBe(true);
    await act(async () => { finish?.(fictionalWorkspace); await old; });
    expect(screen.queryByRole('heading', { name: fictionalWorkspace.event.name })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: next.event.name })).toBeVisible();
  });
  it('aborts outstanding reads on route exit and reports actual session expiry to the composition root', async () => {
    const client = fakeSetup();
    let finish: ((workspace: EventWorkspace) => void) | undefined;
    const pending = new Promise<EventWorkspace>((resolve) => { finish = resolve; });
    vi.mocked(client.load).mockReturnValueOnce(pending);
    const onSessionExpired = vi.fn();
    const props = { client, eventId: fictionalWorkspace.event.id, view: 'overview' as const, onSessionExpired };
    const view = render(<SavedEventPage {...props} />);
    view.unmount();
    expect(vi.mocked(client.load).mock.calls[0]?.[1].aborted).toBe(true);
    await act(async () => { finish?.(fictionalWorkspace); await pending; });
    vi.mocked(client.load).mockRejectedValueOnce(new SessionExpiredError('Sign in again.'));
    render(<SavedEventPage {...props} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Sign in again');
    expect(onSessionExpired).toHaveBeenCalledWith('Sign in again.');
  });
});
