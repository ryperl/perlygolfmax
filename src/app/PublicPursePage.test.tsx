import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { fictionalPurse } from '../../tests/smoke/purse-fixture-data';
import { publicPurseSummary } from '../domain/public-purse';
import type { PublicPurseSummary } from '../domain/public-purse';
import type { PublicPurseClient } from '../client/public-purse';
import { SessionExpiredError } from '../client/events';
import { PublicPursePage } from './PublicPursePage';

const value = publicPurseSummary(fictionalPurse());
function client(): PublicPurseClient {
  return { load: vi.fn().mockResolvedValue(value), save: vi.fn() };
}
describe('public purse loading', () => {
  it('loads once, refreshes without losing the selected course, and clears results on access end', async () => {
    const service = client();
    const expired = vi.fn();
    render(<PublicPursePage client={service} eventId={value.eventId} onSessionExpired={expired} />);
    const picker = await screen.findByRole('combobox', { name: 'Course' });
    fireEvent.change(picker, { target: { value: 'event' } });
    await waitFor(() => { expect(screen.getByRole('button', { name: 'Refresh prize results' })).toBeEnabled(); });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh prize results' }));
    await waitFor(() => { expect(service.load).toHaveBeenCalledTimes(2); });
    expect(picker).toHaveValue('event');
    await waitFor(() => { expect(screen.getByRole('button', { name: 'Refresh prize results' })).toBeEnabled(); });
    vi.mocked(service.load).mockRejectedValueOnce(new SessionExpiredError('Event no longer available.'));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh prize results' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Event no longer available');
    expect(screen.queryByRole('list', { name: 'Player winnings' })).not.toBeInTheDocument();
    expect(expired).toHaveBeenCalledWith('Event no longer available.');
    expect(service.save).not.toHaveBeenCalled();
  });
  it('aborts replaced/unmounted requests and ignores late old data or errors', async () => {
    let resolve: ((value: PublicPurseSummary) => void) | undefined;
    const old = client();
    vi.mocked(old.load).mockReturnValue(new Promise((complete) => { resolve = complete; }));
    const props = { eventId: value.eventId, onSessionExpired: vi.fn() };
    const view = render(<PublicPursePage {...props} client={old} />);
    const latest = client();
    view.rerender(<PublicPursePage {...props} client={latest} />);
    await screen.findByRole('list', { name: 'Player winnings' });
    expect(vi.mocked(old.load).mock.calls[0]?.[1].aborted).toBe(true);
    await act(async () => { resolve?.({ ...value, eventName: 'Fictional stale event' }); await Promise.resolve(); });
    expect(screen.queryByText('Fictional stale event')).not.toBeInTheDocument();
    view.unmount();
    expect(vi.mocked(latest.load).mock.calls[0]?.[1].aborted).toBe(true);
  });
});
