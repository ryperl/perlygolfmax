import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { RateLimitedError } from '../../client/event-administration';
import type { EventAdministrationClient } from '../../client/event-administration';
import { EventChangedError, SessionExpiredError } from '../../client/events';
import type { QuickRoundAdministrationPage } from '../../domain/event-administration';
import { ArchivedEventDeletion } from './ArchivedEventDeletion';
import { QuickRoundAdministration } from './QuickRoundAdministration';

const id = '00000000-0000-4000-8000-000000000001';
const requestId = '00000000-0000-4000-8000-000000000002';
const event = { id, name: 'Fictional Quick round', status: 'archived', etag: 'fictional-v1' } as const;
const instant = { spacingMs: 0, retryDelaysMs: [0, 0], rateLimitWaitMs: 0 };
function fixture() {
  const client = {
    listQuick: vi.fn<EventAdministrationClient['listQuick']>().mockResolvedValue({ events: [event] }),
    restore: vi.fn<EventAdministrationClient['restore']>().mockResolvedValue({ eventId: id, requestId, status: 'active' }),
    deleteArchived: vi.fn<EventAdministrationClient['deleteArchived']>().mockResolvedValue({ eventId: id, requestId, state: 'deleting' }),
    listDeletions: vi.fn<EventAdministrationClient['listDeletions']>().mockResolvedValue({ deletions: [] }),
    continueDeletion: vi.fn<EventAdministrationClient['continueDeletion']>().mockResolvedValue({ eventId: id, requestId, state: 'deleted' }),
  } satisfies EventAdministrationClient;
  return client;
}

describe('Organizer Quick round lifecycle UI', () => {
  it('retains loaded page progress on error and retries the same cursor without presenting a partial list as complete', async () => {
    const user = userEvent.setup();
    const client = fixture();
    client.listQuick.mockResolvedValueOnce({ events: [{ ...event, status: 'active' }], continuationToken: 'fictional-page-2' })
      .mockRejectedValueOnce(new Error('Fictional page unavailable'))
      .mockResolvedValueOnce({ events: [{ ...event, id: requestId, name: 'Fictional Second', status: 'active' }] });
    render(<QuickRoundAdministration client={client} />);
    await user.click(screen.getByRole('button', { name: 'Load Quick rounds' }));
    expect(await screen.findByText(/not the complete list/)).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Load more Quick rounds' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Fictional page unavailable');
    expect(screen.getByRole('link', { name: `Open ${event.name}` })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Retry Quick round page' }));
    expect(await screen.findByRole('heading', { name: 'Fictional Second' })).toBeVisible();
    expect(client.listQuick.mock.calls[1]?.[1]).toBe('fictional-page-2');
    expect(client.listQuick.mock.calls[2]?.[1]).toBe('fictional-page-2');
    expect(screen.getByText('All pages loaded for this list.')).toBeVisible();
  });

  it('keeps archive management separate from public links, retries restore with the same identity and refreshes the host only after acknowledgement', async () => {
    const user = userEvent.setup();
    const client = fixture();
    client.restore.mockRejectedValueOnce(new Error('Fictional restore unavailable'));
    const changed = vi.fn();
    render(<QuickRoundAdministration client={client} onChanged={changed} />);
    await user.click(screen.getByRole('button', { name: 'Archived Quick rounds' }));
    const restore = await screen.findByRole('button', { name: `Restore ${event.name}` });
    expect(screen.queryByRole('link', { name: `Open ${event.name}` })).not.toBeInTheDocument();
    await user.click(restore);
    expect(await screen.findByRole('alert')).toHaveTextContent('Fictional restore unavailable');
    expect(changed).not.toHaveBeenCalled();
    await user.click(restore);
    await waitFor(() => { expect(changed).toHaveBeenCalledOnce(); });
    expect(client.restore.mock.calls[0]?.[1]).toBe(client.restore.mock.calls[1]?.[1]);
    expect(screen.getByRole('heading', { name: 'Quick rounds' })).toHaveFocus();
  });

  it('requires exact confirmation, retries with the same identity, then finishes automatically with few requests', async () => {
    const user = userEvent.setup();
    const client = fixture();
    client.deleteArchived.mockRejectedValueOnce(new Error('Fictional deletion unavailable'))
      .mockRejectedValueOnce(new Error('Fictional deletion unavailable'))
      .mockRejectedValueOnce(new Error('Fictional deletion unavailable'))
      .mockResolvedValueOnce({ eventId: id, requestId, state: 'deleting', progress: { stage: 'records', removed: 50 } });
    client.continueDeletion.mockResolvedValueOnce({ eventId: id, requestId, state: 'deleted', progress: { stage: 'finished', removed: 120 } });
    const deleted = vi.fn();
    render(<ArchivedEventDeletion client={client} event={event} onDeleted={deleted} pacing={instant} />);
    await user.click(screen.getByRole('button', { name: `Permanently delete ${event.name}` }));
    const confirmation = screen.getByRole('textbox', { name: `Type ${event.name} to confirm` });
    expect(confirmation).toHaveFocus();
    await user.type(confirmation, 'Wrong fictional name');
    expect(screen.getByRole('button', { name: 'Permanently delete event' })).toBeDisabled();
    await user.clear(confirmation);
    await user.type(confirmation, event.name);
    await user.click(screen.getByRole('button', { name: 'Permanently delete event' }));
    // The first attempt plus two automatic retries, then it stops and asks.
    expect(await screen.findByRole('alert')).toHaveTextContent('Fictional deletion unavailable');
    expect(client.deleteArchived).toHaveBeenCalledTimes(3);
    expect(confirmation).toHaveValue(event.name);
    expect(deleted).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Retry deletion' }));
    await waitFor(() => { expect(deleted).toHaveBeenCalledWith(id, 120); });
    // One click: the claim request plus a single automatic continuation.
    expect(client.deleteArchived).toHaveBeenCalledTimes(4);
    expect(client.continueDeletion).toHaveBeenCalledOnce();
    const identities = [...client.deleteArchived.mock.calls.map((call) => call[2]), client.continueDeletion.mock.calls[0]?.[1]];
    expect(new Set(identities).size).toBe(1);
  });

  it('shows live progress while running and spaces automatic requests to respect the API limit', async () => {
    const user = userEvent.setup();
    const client = fixture();
    const sentAt: number[] = [];
    let finish: (() => void) | undefined;
    client.deleteArchived.mockImplementation(() => {
      sentAt.push(Date.now());
      return Promise.resolve({ eventId: id, requestId, state: 'deleting', progress: { stage: 'links', removed: 0 } });
    });
    client.continueDeletion.mockImplementationOnce(() => {
      sentAt.push(Date.now());
      return Promise.resolve({ eventId: id, requestId, state: 'deleting', progress: { stage: 'records', removed: 50 } });
    }).mockImplementationOnce(() => new Promise((done) => {
      sentAt.push(Date.now());
      finish = () => { done({ eventId: id, requestId, state: 'deleted', progress: { stage: 'finished', removed: 75 } }); };
    }));
    const deleted = vi.fn();
    render(<ArchivedEventDeletion client={client} event={event} onDeleted={deleted} pacing={{ ...instant, spacingMs: 40 }} />);
    await user.click(screen.getByRole('button', { name: `Permanently delete ${event.name}` }));
    await user.type(screen.getByRole('textbox', { name: `Type ${event.name} to confirm` }), event.name);
    await user.click(screen.getByRole('button', { name: 'Permanently delete event' }));
    expect(await screen.findByText('Step 2 of 2: removing event records (50 removed so far)…')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Deleting…' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Cancel deletion' })).not.toBeInTheDocument();
    await waitFor(() => { expect(finish).toBeDefined(); });
    act(() => { finish?.(); });
    await waitFor(() => { expect(deleted).toHaveBeenCalledWith(id, 75); });
    for (let index = 1; index < sentAt.length; index++) {
      expect((sentAt[index] ?? 0) - (sentAt[index - 1] ?? 0)).toBeGreaterThanOrEqual(35);
    }
  });

  it('stops without retrying when the session expires, and waits out a rate limit before continuing', async () => {
    const user = userEvent.setup();
    const client = fixture();
    client.continueDeletion.mockRejectedValueOnce(new RateLimitedError('Fictional rate limit'))
      .mockRejectedValueOnce(new SessionExpiredError('Fictional session expired'))
      .mockResolvedValueOnce({ eventId: id, requestId, state: 'deleted', progress: { stage: 'finished', removed: 3 } });
    const deleted = vi.fn();
    render(<ArchivedEventDeletion client={client} event={event} onDeleted={deleted} pacing={{ ...instant, rateLimitWaitMs: 60 }} />);
    await user.click(screen.getByRole('button', { name: `Permanently delete ${event.name}` }));
    await user.type(screen.getByRole('textbox', { name: `Type ${event.name} to confirm` }), event.name);
    await user.click(screen.getByRole('button', { name: 'Permanently delete event' }));
    expect(await screen.findByText(/Request limit reached. Waiting a minute/)).toBeVisible();
    expect(await screen.findByRole('alert')).toHaveTextContent('Fictional session expired');
    expect(client.continueDeletion).toHaveBeenCalledTimes(2);
    expect(screen.getByText(/Deletion paused/)).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Resume deletion' }));
    await waitFor(() => { expect(deleted).toHaveBeenCalledWith(id, 3); });
    expect(client.deleteArchived).toHaveBeenCalledOnce();
  });

  it('cancels without a request and restores keyboard focus, and never offers deletion for active events', async () => {
    const user = userEvent.setup();
    const client = fixture();
    const { rerender } = render(<ArchivedEventDeletion client={client} event={event} onDeleted={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: `Permanently delete ${event.name}` }));
    await user.click(screen.getByRole('button', { name: 'Cancel deletion' }));
    expect(screen.getByRole('button', { name: `Permanently delete ${event.name}` })).toHaveFocus();
    expect(client.deleteArchived).not.toHaveBeenCalled();
    rerender(<ArchivedEventDeletion client={client} event={{ ...event, status: 'active' }} onDeleted={vi.fn()} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('resumes an unfinished server job to completion with one click and reports the records removed', async () => {
    const user = userEvent.setup();
    const client = fixture();
    client.listDeletions.mockResolvedValue({ deletions: [{ eventId: id, requestId, state: 'deleting' }] });
    client.continueDeletion.mockResolvedValueOnce({ eventId: id, requestId, state: 'deleting', progress: { stage: 'records', removed: 400 } })
      .mockResolvedValueOnce({ eventId: id, requestId, state: 'deleted', progress: { stage: 'finished', removed: 412 } });
    render(<QuickRoundAdministration client={client} deletionPacing={instant} />);
    await user.click(screen.getByRole('button', { name: 'Check unfinished deletions' }));
    await user.click(await screen.findByRole('button', { name: 'Resume deletion' }));
    expect(await screen.findByText(/business data permanently deleted \(412 event records removed\)/)).toBeVisible();
    expect(client.continueDeletion).toHaveBeenCalledTimes(2);
    expect(client.continueDeletion.mock.calls.every((call) => call[1] === requestId)).toBe(true);
  });

  it('disables restoration once deletion starts, including while deletion is paused', async () => {
    const user = userEvent.setup();
    const client = fixture();
    client.continueDeletion.mockRejectedValue(new EventChangedError('Fictional pending operation'));
    render(<QuickRoundAdministration client={client} deletionPacing={instant} />);
    await user.click(screen.getByRole('button', { name: 'Archived Quick rounds' }));
    await user.click(await screen.findByRole('button', { name: `Permanently delete ${event.name}` }));
    await user.type(screen.getByRole('textbox', { name: `Type ${event.name} to confirm` }), event.name);
    await user.click(screen.getByRole('button', { name: 'Permanently delete event' }));
    expect(await screen.findByRole('button', { name: 'Resume deletion' })).toBeEnabled();
    expect(screen.getByRole('button', { name: `Restore ${event.name}` })).toBeDisabled();
    expect(client.restore).not.toHaveBeenCalled();
  });

  it('stops sending deletion requests when the page closes mid-deletion, leaving the job resumable', async () => {
    const user = userEvent.setup();
    const client = fixture();
    let respond: (() => void) | undefined;
    client.continueDeletion.mockImplementation(() => new Promise((done) => {
      respond = () => { done({ eventId: id, requestId, state: 'deleting', progress: { stage: 'records', removed: 50 } }); };
    }));
    const { unmount } = render(<ArchivedEventDeletion client={client} event={event} onDeleted={vi.fn()} pacing={instant} />);
    await user.click(screen.getByRole('button', { name: `Permanently delete ${event.name}` }));
    await user.type(screen.getByRole('textbox', { name: `Type ${event.name} to confirm` }), event.name);
    await user.click(screen.getByRole('button', { name: 'Permanently delete event' }));
    await waitFor(() => { expect(client.continueDeletion).toHaveBeenCalledOnce(); });
    const requestSignal = client.continueDeletion.mock.calls[0]?.[2];
    unmount();
    expect(requestSignal?.aborted).toBe(true);
    await act(async () => { respond?.(); await Promise.resolve(); });
    expect(client.continueDeletion).toHaveBeenCalledOnce();
  });

  it('aborts superseded reads on unmount and never publishes their result', async () => {
    const user = userEvent.setup();
    const client = fixture();
    let resolve: ((page: QuickRoundAdministrationPage) => void) | undefined;
    client.listQuick.mockImplementation(() => new Promise((done) => { resolve = done; }));
    const { unmount } = render(<QuickRoundAdministration client={client} />);
    await user.click(screen.getByRole('button', { name: 'Load Quick rounds' }));
    const requestSignal = client.listQuick.mock.calls[0]?.[0];
    unmount();
    expect(requestSignal?.aborted).toBe(true);
    act(() => { resolve?.({ events: [event] }); });
  });
});
