import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventsPage } from './EventsPage';
import type { EventServices } from './EventsPage';
import type { EventPage, EventSummary } from '../domain/events';
import { EventChangedError, SessionExpiredError } from '../client/events';
import { fakeCatalog, fakeSetup, fictionalEvent } from '../client/catalog.test-support';
import { fakeScores, fictionalRoundScores, scoreResult } from '../client/scoring.test-support';

const saved: EventSummary = { id: '00000000-0000-4000-8000-000000000001', name: 'Fictional Open', createdAt: '2026-01-01', role: 'owner', status: 'active', etag: 'fictional-v1' };
function service(): EventServices {
  return {
    catalog: fakeCatalog(), setup: fakeSetup(), scores: fakeScores(),
    session: { initialize: vi.fn().mockResolvedValue(true), signIn: vi.fn().mockResolvedValue(undefined), signOut: vi.fn().mockResolvedValue(undefined), token: vi.fn().mockResolvedValue('fictional') },
    events: { capabilities: vi.fn().mockResolvedValue({ canCreateEvents: true, canManageCatalog: false }), list: vi.fn().mockResolvedValue({ events: [] }), create: vi.fn().mockResolvedValue(saved), setStatus: vi.fn().mockResolvedValue({ ...saved, status: 'archived', etag: 'fictional-v2' }) },
  };
}
beforeEach(() => { window.history.replaceState(null, '', '/'); });
describe('EventsPage composition', () => {
  it('restores owner score routes without catalog authority and returns expired scoring sessions to Sign in', async () => {
    const services = service();
    window.history.replaceState(null, '', `#events?event=${fictionalRoundScores.eventId}&round=${fictionalRoundScores.roundId}`);
    vi.mocked(services.scores.load).mockRejectedValueOnce(new SessionExpiredError('Your scoring session expired. Sign in again.'));
    render(<EventsPage services={services} />);
    expect(await screen.findByRole('button', { name: /Sign in/ })).toBeVisible();
    expect(services.scores.load).toHaveBeenCalledWith(fictionalRoundScores.eventId, fictionalRoundScores.roundId, expect.any(AbortSignal));
    expect(services.catalog.courses).not.toHaveBeenCalled();
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
  });
  it('shows owner scoring without manager permission and aborts its read on route change/signout', async () => {
    const services = service();
    window.history.replaceState(null, '', `#events?event=${fictionalRoundScores.eventId}&round=${fictionalRoundScores.roundId}`);
    render(<EventsPage services={services} />);
    expect(await screen.findByRole('heading', { name: 'Round scores' })).toBeVisible();
    await screen.findByRole('table', { name: 'Front nine scorecard' });
    expect(services.catalog.players).not.toHaveBeenCalled();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    await screen.findByRole('button', { name: /Sign in/ });
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
    expect(services.session.signOut).toHaveBeenCalledOnce();
  });
  it('blocks malformed score routes before scores client access', async () => {
    const services = service();
    window.history.replaceState(null, '', '#events?event=invalid&round=invalid');
    render(<EventsPage services={services} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid event or round identifier');
    expect(services.scores.load).not.toHaveBeenCalled();
  });
  it('aborts an in-flight score save on navigation and never restores private scoring UI from a late acknowledgement', async () => {
    const services = service();
    let finish: (() => void) | undefined;
    vi.mocked(services.scores.save).mockImplementationOnce((_eventId, _roundId, playerId, holeNumber, score, etag, id) => new Promise((resolve) => {
      finish = () => { resolve(scoreResult({
        ...scoreResult().change, playerId, holeNumber, after: score, expectedEtag: etag, id,
      })); };
    }));
    window.history.replaceState(null, '', `#events?event=${fictionalRoundScores.eventId}&round=${fictionalRoundScores.roundId}`);
    render(<EventsPage services={services} />);
    await screen.findByRole('heading', { name: 'Round scorecard' });
    await userEvent.setup().click(screen.getByRole('button', { name: 'Enter scores' }));
    const form = within(await screen.findByRole('form', { name: 'Group 1 hole 1 entry' }));
    const user = userEvent.setup();
    await user.type(form.getByRole('textbox', { name: 'Fictional Player 1 score' }), 'X7');
    await user.click(form.getByRole('button', { name: 'Save changes' }));
    expect(services.scores.save).toHaveBeenCalledOnce();
    act(() => {
      window.history.replaceState(null, '', '#events');
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(vi.mocked(services.scores.save).mock.calls[0]?.[7].aborted).toBe(true);
    await act(async () => { finish?.(); await Promise.resolve(); });
    expect(services.scores.save).toHaveBeenCalledOnce();
    expect(screen.queryByRole('heading', { name: 'Round scores' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Save acknowledged/)).not.toBeInTheDocument();
  });
  it('shows catalog navigation only for managers, not for event creators/owners without catalog permission', async () => {
    const services = service();
    const { unmount } = render(<EventsPage services={services} />);
    await screen.findByLabelText('Event name');
    expect(screen.queryByRole('link', { name: 'Course catalog' })).not.toBeInTheDocument();
    unmount();
    vi.mocked(services.events.capabilities).mockResolvedValue({ canCreateEvents: true, canManageCatalog: true });
    render(<EventsPage services={services} />);
    expect(await screen.findByRole('link', { name: 'Course catalog' })).toHaveAttribute('href', '#events?catalog=courses');
    expect(screen.getByRole('link', { name: 'Player catalog' })).toHaveAttribute('href', '#events?catalog=players');
  });
  it('restores a manager catalog deep link and updates routes within Events without returning to fictional views', async () => {
    const services = service();
    vi.mocked(services.events.capabilities).mockResolvedValue({ canCreateEvents: true, canManageCatalog: true });
    window.history.replaceState(null, '', '#events?catalog=courses');
    render(<EventsPage services={services} />);
    expect(await screen.findByRole('heading', { name: 'Saved course catalog' })).toBeVisible();
    act(() => {
      window.history.replaceState(null, '', '#events?catalog=players');
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(await screen.findByRole('heading', { name: 'Saved player catalog' })).toBeVisible();
    act(() => {
      window.history.replaceState(null, '', `#events?event=${fictionalEvent.id}`);
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(await screen.findByRole('heading', { name: 'Event setup' })).toBeVisible();
    expect(services.setup.load).toHaveBeenCalledWith(fictionalEvent.id, expect.any(AbortSignal));
  });
  it('blocks direct catalog URLs independently of event creation permission', async () => {
    const services = service();
    window.history.replaceState(null, '', '#events?catalog=players');
    render(<EventsPage services={services} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Catalog access is restricted');
    expect(services.catalog.players).not.toHaveBeenCalled();
    expect(screen.queryByRole('link', { name: 'Player catalog' })).not.toBeInTheDocument();
  });
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
    expect(screen.getByLabelText('Event name')).toHaveValue(saved.name);
    await user.click(screen.getByRole('button', { name: 'Create event' }));
    await screen.findByText('Event saved.');
    const calls = vi.mocked(services.events.create).mock.calls;
    expect(calls[0]?.[1]).toBe(calls[1]?.[1]);
    expect(screen.getByRole('heading', { name: saved.name })).toBeVisible();
    expect(screen.getByLabelText('Event name')).toHaveValue('');
  });

  it('preserves a pending name until confirmation and starts the next event with a fresh request ID', async () => {
    const services = service();
    let finish: ((event: EventSummary) => void) | undefined;
    const response = new Promise<EventSummary>((resolve) => { finish = resolve; });
    vi.mocked(services.events.create).mockReturnValueOnce(response);
    const user = userEvent.setup();
    render(<EventsPage services={services} />);
    const name = await screen.findByLabelText('Event name');
    await user.type(name, saved.name);
    await user.click(screen.getByRole('button', { name: 'Create event' }));
    expect(name).toHaveValue(saved.name);
    expect(name).toBeDisabled();
    await act(async () => { finish?.(saved); await response; });
    expect(name).toHaveValue('');
    expect(name).toBeEnabled();
    await user.type(name, saved.name);
    await user.click(screen.getByRole('button', { name: 'Create event' }));
    await screen.findByText('Event saved.');
    const calls = vi.mocked(services.events.create).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[1]?.[1]).not.toBe(calls[0]?.[1]);
    expect(name).toHaveValue('');
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

  it('archives and restores through separate lists without granting global creation to an owner', async () => {
    const services = service();
    const archived = { ...saved, status: 'archived', etag: 'event-v2' } as const;
    vi.mocked(services.events.capabilities).mockResolvedValue({ canCreateEvents: false, canManageCatalog: false });
    vi.mocked(services.events.list).mockResolvedValueOnce({ events: [saved] }).mockResolvedValueOnce({ events: [archived] }).mockResolvedValueOnce({ events: [saved] });
    vi.mocked(services.events.setStatus).mockResolvedValueOnce(archived).mockResolvedValueOnce({ ...saved, etag: 'event-v3' });
    const user = userEvent.setup();
    render(<EventsPage services={services} />);
    await user.click(await screen.findByRole('button', { name: 'Archive Fictional Open' }));
    await screen.findByText('Event archived. Its data was preserved.');
    expect(screen.queryByRole('heading', { name: saved.name })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Archived events' }));
    await user.click(await screen.findByRole('button', { name: 'Restore Fictional Open' }));
    await screen.findByText('Event restored to Active events.');
    expect(services.events.list).toHaveBeenLastCalledWith(expect.any(AbortSignal), undefined, 'archived');
    expect(services.events.setStatus).toHaveBeenLastCalledWith(archived, 'active', expect.any(AbortSignal));
    await user.click(screen.getByRole('button', { name: 'Active events' }));
    expect(await screen.findByRole('heading', { name: saved.name })).toBeVisible();
    expect(screen.queryByLabelText('Event name')).not.toBeInTheDocument();
  });

  it('retains the event after archive failure or conflict and blocks overlapping navigation', async () => {
    const services = service();
    vi.mocked(services.events.list).mockResolvedValue({ events: [saved] });
    let fail: ((error: Error) => void) | undefined;
    const response = new Promise<EventSummary>((_resolve, reject) => { fail = reject; });
    vi.mocked(services.events.setStatus).mockReturnValueOnce(response)
      .mockRejectedValueOnce(new EventChangedError('The event changed. Refresh events before trying again.'));
    const user = userEvent.setup();
    render(<EventsPage services={services} />);
    await user.click(await screen.findByRole('button', { name: 'Archive Fictional Open' }));
    expect(screen.getByRole('button', { name: 'Archived events' })).toBeDisabled();
    expect(screen.getByRole('heading', { name: saved.name })).toBeVisible();
    await act(async () => { fail?.(new Error('network unavailable')); await response.catch(() => undefined); });
    expect(screen.getByRole('heading', { name: saved.name })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Archive Fictional Open' }));
    expect(await screen.findByText(/The event changed/)).toBeVisible();
    expect(screen.getByRole('heading', { name: saved.name })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Archive Fictional Open' })).toBeEnabled();
  });
});
