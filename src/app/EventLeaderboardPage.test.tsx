import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { fictionalId, fictionalWorkspace } from '../client/catalog.test-support';
import type { EventLeaderboardClient } from '../client/event-leaderboard';
import { EventChangedError, SessionExpiredError } from '../client/events';
import { PrivateRequestError } from '../client/private-request';
import type { EventLeaderboardView } from '../domain/event-leaderboard';
import { EventLeaderboardPage } from './EventLeaderboardPage';

const value: EventLeaderboardView = { workspace: fictionalWorkspace, roundScores: [],
  standings: { status: 'disabled', players: [], rounds: [], staleRoundIds: [] } };
function deferred<T>() {
  let resolve: (value: T) => void = () => { throw new Error('Not initialized'); };
  let reject: (error: Error) => void = () => { throw new Error('Not initialized'); };
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function mount(client: EventLeaderboardClient = { load: vi.fn().mockResolvedValue(value) }) {
  const props = { client, eventId: value.workspace.event.id, onSessionExpired: vi.fn() };
  return { props, ...render(<EventLeaderboardPage {...props} />) };
}
describe('overall result request lifecycle', () => {
  it('makes one aggregate request, handles disabled routes, and refreshes manually without stale success', async () => {
    const client = { load: vi.fn().mockResolvedValue(value) };
    const pending = deferred<EventLeaderboardView>();
    mount(client);
    await screen.findByRole('heading', { name: /not enabled/ });
    expect(client.load).toHaveBeenCalledOnce();
    client.load.mockReturnValueOnce(pending.promise);
    await userEvent.click(screen.getByRole('button', { name: 'Refresh overall results' }));
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Loading overall results');
    await act(async () => { pending.reject(new EventChangedError('Changed')); await Promise.resolve(); });
    expect(screen.getByRole('alert')).toHaveTextContent('event changed');
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
  });
  it('immediately hides old results, aborts switches/client changes/unmount and ignores late responses', async () => {
    const old = deferred<EventLeaderboardView>();
    const client = { load: vi.fn<EventLeaderboardClient['load']>().mockResolvedValueOnce(value).mockReturnValueOnce(old.promise) };
    const view = mount(client);
    await screen.findByRole('heading', { name: /not enabled/ });
    const secondEvent = fictionalId(51);
    view.rerender(<EventLeaderboardPage {...view.props} eventId={secondEvent} />);
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
    const secondSignal = client.load.mock.calls[1]?.[1];
    const next = deferred<EventLeaderboardView>();
    const replacement = { load: vi.fn<EventLeaderboardClient['load']>().mockReturnValue(next.promise) };
    view.rerender(<EventLeaderboardPage {...view.props} client={replacement} />);
    expect(secondSignal?.aborted).toBe(true);
    await act(async () => { old.resolve(value); await Promise.resolve(); });
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
    view.unmount();
    expect(replacement.load.mock.calls[0]?.[1].aborted).toBe(true);
  });
  it('does not resurrect a previous success on A→B→A or let stale denial/expiry affect the new request', async () => {
    const old = deferred<EventLeaderboardView>();
    const latest = deferred<EventLeaderboardView>();
    const client = { load: vi.fn<EventLeaderboardClient['load']>()
      .mockResolvedValueOnce(value).mockReturnValueOnce(old.promise).mockReturnValueOnce(latest.promise) };
    const view = mount(client);
    await screen.findByRole('heading', { name: /not enabled/ });
    view.rerender(<EventLeaderboardPage {...view.props} eventId={fictionalId(51)} />);
    view.rerender(<EventLeaderboardPage {...view.props} />);
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Loading overall results');
    await act(async () => { old.reject(new SessionExpiredError('Old expiry')); await Promise.resolve(); });
    expect(view.props.onSessionExpired).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await act(async () => { latest.resolve(value); await Promise.resolve(); });
    expect(screen.getByRole('heading', { name: /not enabled/ })).toBeVisible();
  });
  it.each([
    [new PrivateRequestError(403, 'Owner access denied'), false, 'Owner access denied'],
    [new PrivateRequestError(404, 'Event unavailable'), false, 'Event unavailable'],
    [new PrivateRequestError(401, 'Session expired'), true, 'Session expired'],
    [new SessionExpiredError('Sign in again'), true, 'Sign in again'],
    [new PrivateRequestError(429, 'Rate limited', 9), false, 'Retry after 9 seconds'],
    [new Error('Service unavailable'), false, 'Service unavailable'],
  ] as const)('clears private results and classifies %s without false expiry', async (failure, expired, message) => {
    const client = { load: vi.fn().mockResolvedValueOnce(value).mockRejectedValueOnce(failure) };
    const view = mount(client);
    await screen.findByRole('heading', { name: /not enabled/ });
    await userEvent.click(screen.getByRole('button', { name: 'Refresh overall results' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
    expect(view.props.onSessionExpired).toHaveBeenCalledTimes(expired ? 1 : 0);
  });
  it('rejects a wrong-event or member response without exposing private standings', async () => {
    const client = { load: vi.fn().mockResolvedValue({ ...value, workspace: { ...fictionalWorkspace,
      event: { ...fictionalWorkspace.event, role: 'member' } } }) };
    const view = mount(client);
    expect(await screen.findByRole('alert')).toHaveTextContent('owner only');
    client.load.mockResolvedValue({ ...value, workspace: { ...fictionalWorkspace,
      event: { ...fictionalWorkspace.event, id: fictionalId(51) } } });
    await userEvent.click(screen.getByRole('button', { name: 'Refresh overall results' }));
    await waitFor(() => { expect(client.load).toHaveBeenCalledTimes(2); });
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
    expect(view.props.onSessionExpired).not.toHaveBeenCalled();
  });
});
