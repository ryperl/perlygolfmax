import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { EventAdministrationClient } from '../../client/event-administration';
import type { QuickRoundAdministrationPage } from '../../domain/event-administration';
import { ArchivedEventDeletion } from './ArchivedEventDeletion';
import { QuickRoundAdministration } from './QuickRoundAdministration';

const id = '00000000-0000-4000-8000-000000000001';
const requestId = '00000000-0000-4000-8000-000000000002';
const event = { id, name: 'Fictional Quick round', status: 'archived', etag: 'fictional-v1' } as const;
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

  it('requires exact accessible confirmation, retains failed drafts and retry identity, and never claims complete for a partial batch', async () => {
    const user = userEvent.setup();
    const client = fixture();
    client.deleteArchived.mockRejectedValueOnce(new Error('Fictional deletion unavailable'));
    const deleted = vi.fn();
    render(<ArchivedEventDeletion client={client} event={event} onDeleted={deleted} />);
    const trigger = screen.getByRole('button', { name: `Permanently delete ${event.name}` });
    await user.click(trigger);
    const confirmation = screen.getByRole('textbox', { name: `Type ${event.name} to confirm` });
    expect(confirmation).toHaveFocus();
    await user.type(confirmation, 'Wrong fictional name');
    expect(screen.getByRole('button', { name: 'Permanently delete event' })).toBeDisabled();
    await user.clear(confirmation);
    await user.type(confirmation, event.name);
    await user.click(screen.getByRole('button', { name: 'Permanently delete event' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Fictional deletion unavailable');
    expect(confirmation).toHaveValue(event.name);
    expect(deleted).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Retry deletion' }));
    expect(await screen.findByText(/Deletion in progress/)).toBeVisible();
    expect(client.deleteArchived.mock.calls[0]?.[2]).toBe(client.deleteArchived.mock.calls[1]?.[2]);
    expect(deleted).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Continue deletion' }));
    await waitFor(() => { expect(deleted).toHaveBeenCalledWith(id); });
    expect(client.continueDeletion.mock.calls[0]?.[1]).toBe(client.deleteArchived.mock.calls[0]?.[2]);
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

  it('recovers unfinished server jobs without retaining the deleted event name or falsely treating a batch as completion', async () => {
    const user = userEvent.setup();
    const client = fixture();
    client.listDeletions.mockResolvedValue({ deletions: [{ eventId: id, requestId, state: 'deleting' }] });
    client.continueDeletion.mockResolvedValueOnce({ eventId: id, requestId, state: 'deleting' });
    render(<QuickRoundAdministration client={client} />);
    await user.click(screen.getByRole('button', { name: 'Check unfinished deletions' }));
    const resume = await screen.findByRole('button', { name: 'Continue unfinished deletion' });
    await user.click(resume);
    expect(screen.queryByText(/business data permanently deleted/)).not.toBeInTheDocument();
    await user.click(resume);
    expect(await screen.findByText(/business data permanently deleted/)).toBeVisible();
  });

  it('disables restoration once deletion starts, including between acknowledged cleanup batches', async () => {
    const user = userEvent.setup();
    const client = fixture();
    render(<QuickRoundAdministration client={client} />);
    await user.click(screen.getByRole('button', { name: 'Archived Quick rounds' }));
    await user.click(await screen.findByRole('button', { name: `Permanently delete ${event.name}` }));
    await user.type(screen.getByRole('textbox', { name: `Type ${event.name} to confirm` }), event.name);
    await user.click(screen.getByRole('button', { name: 'Permanently delete event' }));
    expect(await screen.findByRole('button', { name: 'Continue deletion' })).toBeEnabled();
    expect(screen.getByRole('button', { name: `Restore ${event.name}` })).toBeDisabled();
    expect(client.restore).not.toHaveBeenCalled();
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
