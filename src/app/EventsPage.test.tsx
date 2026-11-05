import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventsPage } from './EventsPage';
import type { EventServices } from './EventsPage';
import type { EventPage, EventSummary } from '../domain/events';
import { EventChangedError, SessionExpiredError } from '../client/events';
import { fakeCatalog, fakeSetup, fictionalEvent, fictionalWorkspace } from '../client/catalog.test-support';
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
  it('uses the aggregate-only overall route, never starts saved-event progress workers, and makes no Preview prefetch', async () => {
    const leaderboard = { load: vi.fn().mockResolvedValue({ workspace: fictionalWorkspace, roundScores: [],
      standings: { status: 'disabled', rounds: [], players: [], staleRoundIds: [] } }) };
    const services = { ...service(), leaderboard };
    window.history.replaceState(null, '', `#leaderboard?event=${fictionalEvent.id}`);
    const view = render(<EventsPage services={services} />);
    expect(await screen.findByRole('heading', { name: /not enabled/ })).toBeVisible();
    expect(leaderboard.load).toHaveBeenCalledOnce();
    expect(services.setup.load).not.toHaveBeenCalled();
    expect(services.scores.load).not.toHaveBeenCalled();
    expect(services.catalog.courses).not.toHaveBeenCalled();
    view.unmount();
    vi.clearAllMocks();
    render(<EventsPage services={services} preview />);
    await waitFor(() => { expect(screen.getByRole('button', { name: 'Sign out' })).toBeEnabled(); });
    expect(leaderboard.load).not.toHaveBeenCalled();
    expect(services.setup.load).not.toHaveBeenCalled();
    expect(services.scores.load).not.toHaveBeenCalled();
    expect(services.catalog.courses).not.toHaveBeenCalled();
  });
  it('keeps an optional missing overall capability honest without falling back to round/demo results', async () => {
    const services = service();
    window.history.replaceState(null, '', `#leaderboard?event=${fictionalEvent.id}`);
    render(<EventsPage services={services} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Overall results are unavailable in this connection');
    expect(services.scores.load).not.toHaveBeenCalled();
    expect(services.setup.load).not.toHaveBeenCalled();
  });
  it('disables the account control during initialization and sign-out, then reports incomplete provider sign-out', async () => {
    const services = service();
    let initialize: ((value: boolean) => void) | undefined;
    vi.mocked(services.session.initialize).mockImplementationOnce(() => new Promise((resolve) => { initialize = resolve; }));
    let fail: ((error: Error) => void) | undefined;
    vi.mocked(services.session.signOut).mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject; }));
    const onSignedOut = vi.fn();
    render(<EventsPage services={services} onSignedOut={onSignedOut} />);
    expect(screen.getByRole('button', { name: 'Checking account…' })).toBeDisabled();
    await act(async () => { initialize?.(true); await Promise.resolve(); });
    await screen.findByLabelText('Event name');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeDisabled();
    expect(onSignedOut).toHaveBeenCalledOnce();
    expect(screen.queryByLabelText('Event name')).not.toBeInTheDocument();
    await act(async () => { fail?.(new Error('fictional provider failure')); await Promise.resolve(); });
    expect(await screen.findByText(/Sign-out did not complete/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
  });

  it('keeps Preview sign-in pending and shows failure without claiming authenticated access', async () => {
    const services = service();
    vi.mocked(services.session.initialize).mockResolvedValue(false);
    let fail: ((error: Error) => void) | undefined;
    vi.mocked(services.session.signIn).mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject; }));
    render(<EventsPage services={services} preview />);
    const user = userEvent.setup();
    await waitFor(() => { expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled(); });
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeDisabled();
    await act(async () => { fail?.(new Error('fictional provider failure')); await Promise.resolve(); });
    expect(await screen.findByText(/Sign-in did not complete/)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Sign out' })).not.toBeInTheDocument();
    expect(services.events.list).not.toHaveBeenCalled();
  });

  it('discards late account operations and private data when the injected services are replaced', async () => {
    const first = service();
    const second = service();
    let fail: ((error: Error) => void) | undefined;
    vi.mocked(first.session.signOut).mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject; }));
    const { rerender } = render(<EventsPage services={first} />);
    await screen.findByLabelText('Event name');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    rerender(<EventsPage services={second} preview />);
    await waitFor(() => { expect(screen.getByRole('button', { name: 'Sign out' })).toBeEnabled(); });
    await act(async () => { fail?.(new Error('old provider failure')); await Promise.resolve(); });
    expect(screen.queryByText(/Sign-out did not complete/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(second.session.signOut).toHaveBeenCalledOnce();
    expect(first.session.signOut).toHaveBeenCalledOnce();
    expect(second.events.list).not.toHaveBeenCalled();
  });

  it('ignores a replaced client initialization that settles after the new signed-out account', async () => {
    const first = service();
    const second = service();
    let initialize: ((value: boolean) => void) | undefined;
    vi.mocked(first.session.initialize).mockImplementationOnce(() => new Promise((resolve) => { initialize = resolve; }));
    vi.mocked(second.session.initialize).mockResolvedValue(false);
    const { rerender } = render(<EventsPage services={first} preview />);
    rerender(<EventsPage services={second} preview />);
    await waitFor(() => { expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled(); });
    await act(async () => { initialize?.(true); await Promise.resolve(); });
    await userEvent.setup().click(screen.getByRole('button', { name: 'Sign in' }));
    expect(second.session.signIn).toHaveBeenCalledOnce();
    expect(first.session.signIn).not.toHaveBeenCalled();
    expect(first.events.list).not.toHaveBeenCalled();
    expect(second.events.list).not.toHaveBeenCalled();
  });

  it('retries uncertain identity on Preview without incorrectly offering operational sign-in or reading private data', async () => {
    const services = service();
    vi.mocked(services.session.initialize).mockRejectedValueOnce(new Error('fictional unavailable account'));
    render(<EventsPage services={services} preview />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Retry account' }));
    expect(await screen.findByRole('button', { name: 'Sign out' })).toBeEnabled();
    expect(services.session.initialize).toHaveBeenCalledTimes(2);
    expect(services.session.signIn).not.toHaveBeenCalled();
    expect(services.events.list).not.toHaveBeenCalled();
    expect(services.events.capabilities).not.toHaveBeenCalled();
  });

  it('uses the latest sign-out callback without reinitializing the account controller', async () => {
    const services = service();
    const first = vi.fn();
    const current = vi.fn();
    const { rerender } = render(<EventsPage services={services} onSignedOut={first} />);
    await screen.findByLabelText('Event name');
    rerender(<EventsPage services={services} onSignedOut={current} preview />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Sign out' }));
    expect(first).not.toHaveBeenCalled();
    expect(current).toHaveBeenCalledOnce();
    expect(services.session.initialize).toHaveBeenCalledOnce();
  });

  it('does not reuse a failed identity state to enable an account action while replacement services initialize', async () => {
    const first = service();
    const second = service();
    vi.mocked(first.session.initialize).mockRejectedValueOnce(new Error('fictional unavailable account'));
    let initialize: ((value: boolean) => void) | undefined;
    vi.mocked(second.session.initialize).mockImplementationOnce(() => new Promise((resolve) => { initialize = resolve; }));
    const { rerender } = render(<EventsPage services={first} preview />);
    await screen.findByRole('button', { name: 'Retry account' });
    rerender(<EventsPage services={second} preview />);
    expect(screen.getByRole('button', { name: 'Checking account…' })).toBeDisabled();
    await act(async () => { initialize?.(false); await Promise.resolve(); });
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
    expect(second.session.initialize).toHaveBeenCalledOnce();
  });
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
    expect(screen.getAllByRole('button', { name: 'Sign out' })).toHaveLength(1);
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
