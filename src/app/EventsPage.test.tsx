import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { EventsPage } from './EventsPage';
import type { EventServices } from './EventsPage';
import type { EventPage, EventSummary } from '../domain/events';
import { SessionExpiredError } from '../client/events';

const saved: EventSummary = { id: '00000000-0000-4000-8000-000000000001', name: 'Fictional Open', createdAt: '2026-01-01', role: 'owner' };
function service(): EventServices {
  return {
    session: { initialize: vi.fn().mockResolvedValue(true), signIn: vi.fn().mockResolvedValue(undefined), signOut: vi.fn().mockResolvedValue(undefined), token: vi.fn().mockResolvedValue('fictional') },
    events: { capabilities: vi.fn().mockResolvedValue({ canCreateEvents: true }), list: vi.fn().mockResolvedValue({ events: [] }), create: vi.fn().mockResolvedValue(saved) },
  };
}
describe('EventsPage composition', () => {
  it('waits for capabilities and data before enabling creation; retries an uncertain save idempotently', async () => {
    const services = service();
    let finish: ((page: EventPage) => void) | undefined;
    const response = new Promise<EventPage>((resolve) => { finish = resolve; });
    vi.mocked(services.events.list).mockReturnValueOnce(response);
    vi.mocked(services.events.create).mockRejectedValueOnce(new Error('network lost'));
    const user = userEvent.setup();
    render(<EventsPage services={services} />);
    expect(screen.queryByLabelText('Event name')).not.toBeInTheDocument();
    await waitFor(() => { expect(finish).toBeDefined(); });
    await act(async () => { finish?.({ events: [] }); await response; });
    await user.type(await screen.findByLabelText('Event name'), saved.name);
    await user.click(screen.getByRole('button', { name: 'Create event' }));
    await screen.findByText(/operation failed/);
    await user.click(screen.getByRole('button', { name: 'Create event' }));
    await screen.findByText('Event saved.');
    const calls = vi.mocked(services.events.create).mock.calls;
    expect(calls[0]?.[1]).toBe(calls[1]?.[1]);
    expect(screen.getByRole('heading', { name: saved.name })).toBeVisible();
  });
  it('does not present a service failure as no events or allow stale work to restore signed-in UI', async () => {
    const services = service();
    vi.mocked(services.events.list).mockRejectedValue(new Error('storage unavailable'));
    const { unmount } = render(<EventsPage services={services} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not connect');
    expect(screen.queryByText(/No events on this page/)).not.toBeInTheDocument();
    unmount();
    expect(vi.mocked(services.events.list).mock.calls[0]?.[0].aborted).toBe(true);
  });
  it('reinitializes identity and recovers after a transient initialization failure', async () => {
    const services = service();
    vi.mocked(services.session.initialize).mockRejectedValueOnce(new Error('temporary initialization failure'));
    const user = userEvent.setup();
    render(<EventsPage services={services} />);
    await screen.findByRole('alert');
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText(/No events on this page/)).toBeVisible();
    expect(services.session.initialize).toHaveBeenCalledTimes(2);
  });
  it('returns to sign-in when the API rejects a stale session', async () => {
    const services = service();
    vi.mocked(services.events.capabilities).mockRejectedValue(new SessionExpiredError('Sign in again.'));
    render(<EventsPage services={services} />);
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeVisible();
    expect(screen.queryByLabelText('Event name')).not.toBeInTheDocument();
  });
});
