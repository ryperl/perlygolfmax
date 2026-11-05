import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as access from '../../client/test-access';
import { EventChangedError, SessionExpiredError } from '../../client/events';
import type { TesterAccessManagement } from '../../domain/test-access';
import { TesterLinks } from './TesterLinks';
import { credential, deferred, management, testerClient, testerLink } from './test-support';

beforeEach(() => {
  vi.spyOn(access, 'generateTesterSecret').mockResolvedValue({ token: credential.token, tokenHash: 'a'.repeat(64) });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function mount() {
  const store = testerClient();
  const onSessionExpired = vi.fn();
  const rendered = render(<TesterLinks client={store.client} eventId={credential.eventId} onSessionExpired={onSessionExpired} />);
  return { ...store, ...rendered, onSessionExpired };
}

describe('no-account tester link management', () => {
  it('creates an event-scoped secret only in a readonly password field and copies it explicitly', async () => {
    const clipboard = { writeText: vi.fn().mockResolvedValue(undefined) };
    vi.stubGlobal('navigator', { clipboard });
    const { client } = mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Create private tester link' }));
    const field = await screen.findByLabelText('Private tester share link');
    expect(field).toHaveAttribute('type', 'password');
    expect(field).toHaveAttribute('readonly');
    expect(field.getAttribute('value')).toContain('#tester?event=');
    expect(screen.queryByText(credential.token)).not.toBeInTheDocument();
    const call = vi.mocked(client.create).mock.calls[0];
    expect(call?.[0]).toBe(credential.eventId);
    expect(call?.[1].tokenHash).toBe('a'.repeat(64));
    expect(call?.[2]).toBe(management.etag);
    expect(call?.[3]).toMatch(/^[a-f0-9-]{36}$/);
    expect(clipboard.writeText).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Copy private tester link' }));
    await screen.findByText('Private tester link copied.');
    expect(clipboard.writeText).toHaveBeenCalledWith(field.getAttribute('value'));
  });

  it('retains the exact uncertain create operation and secret for explicit retry', async () => {
    const { client } = mount();
    vi.mocked(client.create).mockRejectedValueOnce(new Error('Connection interrupted'));
    fireEvent.click(await screen.findByRole('button', { name: 'Create private tester link' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Retry original tester operation' }));
    await screen.findByLabelText('Private tester share link');
    const calls = vi.mocked(client.create).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[1]?.slice(0, 4)).toEqual(calls[0]?.slice(0, 4));
    expect(access.generateTesterSecret).toHaveBeenCalledTimes(1);
  });

  it('does not present a mismatched success receipt as a created link', async () => {
    const { client } = mount();
    vi.mocked(client.create).mockResolvedValueOnce({ operationId: testerLink.linkId, linkId: testerLink.linkId, state: 'active' });
    fireEvent.click(await screen.findByRole('button', { name: 'Create private tester link' }));
    await screen.findByRole('alert');
    expect(screen.queryByLabelText('Private tester share link')).not.toBeInTheDocument();
    expect(screen.queryByText(/Tester link created/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry original tester operation' })).toBeEnabled();
  });

  it('distinguishes an acknowledged creation from a failed follow-up list read', async () => {
    const { client } = mount();
    await screen.findByRole('button', { name: 'Create private tester link' });
    vi.mocked(client.list).mockRejectedValueOnce(new Error('Read interrupted'));
    fireEvent.click(screen.getByRole('button', { name: 'Create private tester link' }));
    await screen.findByText(/operation was acknowledged, but the updated tester link list could not be loaded/);
    expect(screen.getByLabelText('Private tester share link')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Retry original tester operation' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create private tester link' })).not.toBeInTheDocument();
    expect(client.create).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh tester access' }));
    await screen.findByRole('button', { name: 'Create private tester link' });
    expect(screen.queryByLabelText('Private tester share link')).not.toBeInTheDocument();
  });

  it('explains manual copying when clipboard access fails', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('Denied')) } });
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Create private tester link' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Copy private tester link' }));
    await screen.findByText(/Copy failed. Select the private link field/);
    expect(screen.queryByText('Private tester link copied.')).not.toBeInTheDocument();
  });

  it('requires refresh and review on conflict rather than retrying stale revisions', async () => {
    const { client } = mount();
    vi.mocked(client.create).mockRejectedValueOnce(new EventChangedError('Changed'));
    fireEvent.click(await screen.findByRole('button', { name: 'Create private tester link' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Refresh and review tester access' }));
    await waitFor(() => { expect(screen.getByRole('button', { name: 'Create private tester link' })).toBeEnabled(); });
    expect(screen.queryByRole('button', { name: 'Retry original tester operation' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Private tester share link')).not.toBeInTheDocument();
    expect(client.create).toHaveBeenCalledTimes(1);
  });

  it('allows conditional security revocation but not creation in an archived event', async () => {
    const store = testerClient();
    vi.mocked(store.client.list).mockResolvedValue({ ...management, eventStatus: 'archived' });
    render(<TesterLinks client={store.client} eventId={credential.eventId} onSessionExpired={vi.fn()} />);
    expect(await screen.findByRole('button', { name: 'Create private tester link' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Revoke tester link 1' }));
    await screen.findByText('Tester link revoked. Saved scores are preserved.');
    expect(store.client.revoke).toHaveBeenCalledWith(credential.eventId,
      { linkId: testerLink.linkId, revision: testerLink.revision }, management.etag, expect.any(String), expect.any(AbortSignal));
    expect(store.client.create).not.toHaveBeenCalled();
  });

  it('retries uncertain revocation unchanged and clears private data on owner expiry', async () => {
    const { client, onSessionExpired } = mount();
    vi.mocked(client.revoke).mockRejectedValueOnce(new Error('Unconfirmed')).mockRejectedValueOnce(new SessionExpiredError('Expired'));
    fireEvent.click(await screen.findByRole('button', { name: 'Revoke tester link 1' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Retry original tester operation' }));
    await waitFor(() => { expect(onSessionExpired).toHaveBeenCalled(); });
    const calls = vi.mocked(client.revoke).mock.calls;
    expect(calls[1]?.slice(0, 4)).toEqual(calls[0]?.slice(0, 4));
    expect(screen.queryByText('Tester link 1')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry original tester operation' })).not.toBeInTheDocument();
  });

  it('aborts old event requests and suppresses their late results', async () => {
    const store = testerClient();
    const pending = deferred<TesterAccessManagement>();
    vi.mocked(store.client.list).mockReturnValueOnce(pending.promise);
    const { rerender } = render(<TesterLinks client={store.client} eventId={credential.eventId} onSessionExpired={vi.fn()} />);
    const signal = vi.mocked(store.client.list).mock.calls[0]?.[1];
    rerender(<TesterLinks client={store.client} eventId={testerLink.revision} onSessionExpired={vi.fn()} />);
    expect(signal?.aborted).toBe(true);
    await act(async () => { pending.resolve({ ...management, links: [{ ...testerLink, state: 'revoked' }] }); await pending.promise; });
    await screen.findByRole('button', { name: 'Revoke tester link 1' });
    expect(screen.queryByText(/· Revoked/)).not.toBeInTheDocument();
  });
});
