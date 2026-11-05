import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { PurseClient } from '../client/purse';
import { fictionalEventPurse, fictionalPurseWrite } from '../client/purse.test-support';
import { fictionalId } from '../client/catalog.test-support';
import { SessionExpiredError } from '../client/events';
import { PrivateRequestError } from '../client/private-request';
import type { EventPurseView } from '../domain/purse-settings';
import { PursePage } from './PursePage';

function deferred<T>() {
  let resolve: (value: T) => void = () => { throw new Error('Not initialized'); };
  let reject: (error: Error) => void = () => { throw new Error('Not initialized'); };
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function mount() {
  const value = fictionalEventPurse();
  const client: PurseClient = {
    load: vi.fn().mockResolvedValue(value),
    save: vi.fn<PurseClient['save']>().mockImplementation((_eventId, plan, resolutions, etag, requestId) =>
      Promise.resolve(fictionalPurseWrite(value, plan, resolutions, etag, requestId))),
  };
  const props = { client, eventId: value.workspace.event.id, onSessionExpired: vi.fn() };
  return { value, client, props, ...render(<PursePage {...props} />) };
}
describe('private purse request lifecycle', () => {
  it('loads one saved view, preserves drafts on ordinary save failure and forwards exact conditional retries', async () => {
    const f = mount();
    await screen.findByRole('heading', { name: 'Event purse' });
    expect(f.client.load).toHaveBeenCalledOnce();
    await userEvent.click(screen.getByRole('button', { name: 'Edit purse' }));
    expect(screen.getByRole('button', { name: 'Refresh prize results' })).toBeDisabled();
    vi.mocked(f.client.save).mockRejectedValueOnce(new Error('Fictional unavailable service'));
    await userEvent.click(screen.getByRole('button', { name: 'Save purse' }));
    expect(await screen.findByText(/Fictional unavailable service/)).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Planned budget amount' })).toHaveValue('100.00');
    await userEvent.click(screen.getByRole('button', { name: 'Retry purse save' }));
    const calls = vi.mocked(f.client.save).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0]?.slice(0, 5)).toEqual(calls[1]?.slice(0, 5));
    expect(calls[0]?.[3]).toBe('purse-v1');
    expect(await screen.findByText(/Purse settings saved/)).toBeVisible();
  });
  it('hides old private results immediately, aborts switches/unmounts and ignores late responses', async () => {
    const f = mount();
    await screen.findByRole('heading', { name: 'Event purse' });
    const old = deferred<EventPurseView>();
    vi.mocked(f.client.load).mockReturnValueOnce(old.promise);
    f.rerender(<PursePage {...f.props} eventId={fictionalId(99)} />);
    expect(screen.queryByRole('heading', { name: 'Event purse' })).not.toBeInTheDocument();
    const signal = vi.mocked(f.client.load).mock.calls[1]?.[1];
    f.rerender(<PursePage {...f.props} />);
    expect(signal?.aborted).toBe(true);
    await act(async () => { old.resolve(f.value); await Promise.resolve(); });
    expect(f.props.onSessionExpired).not.toHaveBeenCalled();
    await screen.findByRole('heading', { name: 'Event purse' });
    const pending = deferred<EventPurseView>();
    vi.mocked(f.client.load).mockReturnValueOnce(pending.promise);
    await userEvent.click(screen.getByRole('button', { name: 'Refresh prize results' }));
    f.unmount();
    expect(vi.mocked(f.client.load).mock.calls.at(-1)?.[1].aborted).toBe(true);
  });
  it.each([
    [new PrivateRequestError(403, 'Owner access denied'), false],
    [new PrivateRequestError(404, 'Event unavailable'), false],
    [new PrivateRequestError(401, 'Session expired'), true],
    [new SessionExpiredError('Sign in again'), true],
    [new Error('Fictional load failure'), false],
  ] as const)('clears private results on %s and only expires real sessions', async (failure, expired) => {
    const f = mount();
    await screen.findByRole('heading', { name: 'Event purse' });
    vi.mocked(f.client.load).mockRejectedValueOnce(failure);
    await userEvent.click(screen.getByRole('button', { name: 'Refresh prize results' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(failure.message);
    expect(screen.queryByRole('heading', { name: 'Event purse' })).not.toBeInTheDocument();
    expect(f.props.onSessionExpired).toHaveBeenCalledTimes(expired ? 1 : 0);
  });
});
