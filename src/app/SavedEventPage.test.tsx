import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { fakeSetup, fictionalId, fictionalWorkspace } from '../client/catalog.test-support';
import type { EventWorkspace } from '../domain/setup';
import { PrivateRequestError } from '../client/private-request';
import { SessionExpiredError } from '../client/events';
import { SavedEventPage } from './SavedEventPage';

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
