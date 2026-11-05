import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import type { EventServices } from './EventsPage';
import type * as EventsPageModule from './EventsPage';
import { fakeCatalog, fakeSetup, fictionalEvent, fictionalWorkspace } from '../client/catalog.test-support';
import { fakeScores } from '../client/scoring.test-support';
import { SessionExpiredError } from '../client/events';
import type { EventPage } from '../domain/events';
import { fictionalEventPurse } from '../client/purse.test-support';
import { admissionId, admissionsClient, deferred, status } from '../features/admission/test-support';
import { fakeTesterAccessClient, fictionalTesterCredential } from '../client/test-access.test-support';
import { testerUrl } from '../client/test-access';

let testServices: EventServices | undefined;
vi.mock('./EventsPage', async (importOriginal) => {
  const actual = await importOriginal<typeof EventsPageModule>();
  return { ...actual, ConfiguredEventsPage: (props: Omit<Parameters<typeof actual.EventsPage>[0], 'services'>) =>
    <actual.EventsPage services={testServices} {...props} /> };
});

function service(): EventServices {
  const setup = fakeSetup();
  vi.mocked(setup.load).mockResolvedValue(fictionalWorkspace);
  return {
    catalog: fakeCatalog(), setup, scores: fakeScores(),
    session: { initialize: vi.fn().mockResolvedValue(true), signIn: vi.fn().mockResolvedValue(undefined), signOut: vi.fn().mockResolvedValue(undefined), token: vi.fn().mockResolvedValue('fictional') },
    events: {
      capabilities: vi.fn().mockResolvedValue({ canCreateEvents: true, canManageCatalog: false }),
      list: vi.fn().mockResolvedValue({ events: [fictionalEvent] }),
      create: vi.fn().mockResolvedValue(fictionalEvent), setStatus: vi.fn().mockResolvedValue(fictionalEvent),
    },
  };
}
function navigate(hash: string) {
  act(() => {
    window.history.replaceState(null, '', hash || '/');
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });
}
function mainNavigation() { return within(screen.getByRole('navigation', { name: 'Main navigation' })); }
function headerAccount(name: 'Sign in' | 'Sign out') {
  expect(screen.getAllByRole('button', { name: /^Sign (in|out)$/ })).toHaveLength(1);
  return within(screen.getByRole('banner', { name: 'Site header' })).getByRole('button', { name });
}
beforeEach(() => {
  testServices = undefined;
  window.history.replaceState(null, '', '/');
});

describe('App', () => {
  it('opens the no-account tester controls as the primary owner access flow without entering a guest view', async () => {
    const base = service();
    const testerAccess = fakeTesterAccessClient();
    testServices = { ...base, admissions: admissionsClient(), testerAccess };
    navigate(`#access?event=${fictionalEvent.id}`);
    await import('./PlayerAccessPage');
    render(<App />);
    await act(async () => { await vi.dynamicImportSettled(); });
    expect(await screen.findByRole('heading', { name: 'No-account tester access' })).toBeVisible();
    await waitFor(() => { expect(testerAccess.list).toHaveBeenCalledWith(fictionalEvent.id, expect.any(AbortSignal)); });
    expect(headerAccount('Sign out')).toBeEnabled();
    expect(testerAccess.workspace).not.toHaveBeenCalled();
    expect(screen.getByText('Account-based player invitations')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Request access' })).not.toBeInTheDocument();
  });
  it('opens tester score entry without initializing identity or loading global events, and never renders the secret', async () => {
    const base = service();
    const testerAccess = fakeTesterAccessClient();
    testServices = { ...base, testerAccess };
    navigate(new URL(testerUrl(window.location.origin, fictionalTesterCredential)).hash);
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Round scorecard' })).toBeVisible();
    expect(base.session.initialize).not.toHaveBeenCalled();
    expect(base.session.token).not.toHaveBeenCalled();
    expect(base.events.list).not.toHaveBeenCalled();
    expect(base.events.capabilities).not.toHaveBeenCalled();
    expect(base.setup.load).not.toHaveBeenCalled();
    expect(base.scores.load).not.toHaveBeenCalled();
    expect(base.catalog.players).not.toHaveBeenCalled();
    expect(testerAccess.workspace).toHaveBeenCalledWith(fictionalTesterCredential, expect.any(AbortSignal));
    expect(screen.queryByRole('button', { name: /^Sign (in|out)$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Main navigation' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Configure event' })).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(fictionalTesterCredential.token);
    expect(document.title).toBe('Tester score entry | Perly Golf Max');
    navigate('#events');
    await screen.findByRole('heading', { name: 'Events' });
    expect(base.session.initialize).toHaveBeenCalledOnce();
    expect(screen.queryByRole('heading', { name: 'Round scorecard' })).not.toBeInTheDocument();
    expect(mainNavigation().getByRole('link', { name: 'Rounds' })).toHaveAttribute('href', '#rounds');
  });
  it('does not initialize identity or request private data for invalid tester fragments', async () => {
    const base = service();
    const testerAccess = fakeTesterAccessClient();
    testServices = { ...base, testerAccess };
    navigate('#tester?event=invalid');
    render(<App />);
    expect(await screen.findByRole('alert')).toHaveTextContent('This tester link is invalid.');
    expect(base.session.initialize).not.toHaveBeenCalled();
    expect(testerAccess.workspace).not.toHaveBeenCalled();
    expect(base.events.list).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Sign in' })).not.toBeInTheDocument();
  });
  it('keeps signed-out invitation landing private and uses the existing header sign-in action', async () => {
    const base = service();
    const account = deferred<boolean>();
    vi.mocked(base.session.initialize).mockReturnValue(account.promise);
    const admissions = admissionsClient();
    testServices = { ...base, admissions };
    navigate(`#join?event=${admissionId(100)}&invite=${admissionId(200)}&token=${'A'.repeat(43)}`);
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Player invitation' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Checking account…' })).toBeDisabled();
    await act(async () => { account.resolve(false); await account.promise; });
    await within(screen.getByRole('banner', { name: 'Site header' })).findByRole('button', { name: 'Sign in' });
    await userEvent.setup().click(headerAccount('Sign in'));
    expect(base.session.signIn).toHaveBeenCalledOnce();
    expect(base.events.list).not.toHaveBeenCalled();
    expect(base.setup.load).not.toHaveBeenCalled();
    expect(admissions.status).not.toHaveBeenCalled();
    expect(admissions.claim).not.toHaveBeenCalled();
    expect(document.body).not.toHaveTextContent('A'.repeat(43));
  });
  it('strips a claimed secret and refreshes all-active-event discovery after explicit approval', async () => {
    const base = service();
    const admissions = admissionsClient();
    vi.mocked(admissions.status).mockResolvedValue(status('approved'));
    vi.mocked(base.events.capabilities).mockResolvedValue({ canCreateEvents: false, canManageCatalog: false });
    const otherEvent = { ...fictionalEvent, role: 'viewer' as const };
    vi.mocked(base.events.list).mockResolvedValueOnce({ events: [] }).mockResolvedValue({ events: [otherEvent] });
    testServices = { ...base, admissions };
    navigate(`#join?event=${admissionId(100)}&invite=${admissionId(200)}&token=${'A'.repeat(43)}`);
    render(<App />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Request access' }));
    expect(await screen.findByText('ABCD-1234')).toBeVisible();
    expect(window.location.hash).toBe(`#join?event=${admissionId(100)}&claim=${admissionId(200)}`);
    expect(admissions.claim).toHaveBeenCalledWith(admissionId(100), { inviteId: admissionId(200), token: 'A'.repeat(43) },
      expect.any(String), expect.any(AbortSignal));
    await user.click(screen.getByRole('button', { name: 'Check approval' }));
    await screen.findByRole('link', { name: 'Open event overview' });
    await waitFor(() => { expect(base.events.list).toHaveBeenCalledTimes(2); });
    navigate('#events');
    expect(await screen.findByRole('link', { name: `Open ${fictionalEvent.name}` })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Create event' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Course catalog' })).not.toBeInTheDocument();
    expect(base.scores.load).not.toHaveBeenCalled();
    expect(admissions.status).toHaveBeenCalledOnce();
  });
  it('opens private purse deep links and preserves event navigation without prefetching in Preview', async () => {
    const base = service();
    const value = fictionalEventPurse();
    const purse = { load: vi.fn().mockResolvedValue(value), save: vi.fn() };
    testServices = { ...base, purse };
    window.history.replaceState(null, '', `#purse?event=${fictionalEvent.id}`);
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Event purse' })).toBeVisible();
    expect(document.title).toBe('Purse and winnings | Perly Golf Max');
    expect(mainNavigation().getByRole('link', { name: 'Rounds' })).toHaveAttribute('href', `#rounds?event=${fictionalEvent.id}`);
    expect(base.setup.load).not.toHaveBeenCalled();
    expect(base.scores.load).not.toHaveBeenCalled();
    navigate('#preview');
    expect(await screen.findByRole('heading', { name: 'The Coastal Classic' })).toBeVisible();
    expect(purse.load).toHaveBeenCalledOnce();
    navigate(`#purse?event=${fictionalEvent.id}`);
    expect(await screen.findByRole('heading', { name: 'Event purse' })).toBeVisible();
    expect(purse.load).toHaveBeenCalledTimes(2);
  });
  it('opens refresh-safe overall routes and retains event context across navigation/history while leaving Preview private-free', async () => {
    const base = service();
    const leaderboard = { load: vi.fn().mockResolvedValue({ workspace: fictionalWorkspace, roundScores: [],
      standings: { status: 'disabled', rounds: [], players: [], staleRoundIds: [] } }) };
    testServices = { ...base, leaderboard };
    window.history.replaceState(null, '', `#leaderboard?event=${fictionalEvent.id}`);
    render(<App />);
    expect(await screen.findByRole('heading', { name: /not enabled/ })).toBeVisible();
    expect(document.title).toBe('Overall leaderboard | Perly Golf Max');
    expect(mainNavigation().getByRole('link', { name: 'Rounds' })).toHaveAttribute('href', `#rounds?event=${fictionalEvent.id}`);
    expect(base.setup.load).not.toHaveBeenCalled();
    expect(base.scores.load).not.toHaveBeenCalled();
    navigate(`#rounds?event=${fictionalEvent.id}`);
    expect(await screen.findByRole('heading', { level: 1, name: 'Rounds' })).toBeVisible();
    navigate(`#leaderboard?event=${fictionalEvent.id}`);
    expect(await screen.findByRole('heading', { name: /not enabled/ })).toBeVisible();
    expect(leaderboard.load).toHaveBeenCalledTimes(2);
    navigate('#preview');
    expect(await screen.findByRole('heading', { name: 'The Coastal Classic' })).toBeVisible();
    expect(leaderboard.load).toHaveBeenCalledTimes(2);
  });
  it('starts on Events and keeps fictional data behind the explicit Preview link', async () => {
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Events' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Event services are not configured' })).toBeVisible();
    expect(headerAccount('Sign in')).toBeDisabled();
    expect(screen.queryByText('The Coastal Classic')).not.toBeInTheDocument();
    expect(screen.queryByText('12 golfers / 5 rounds')).not.toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole('link', { name: 'Preview' }));
    expect(await screen.findByRole('heading', { name: 'The Coastal Classic' })).toBeVisible();
    expect(screen.getByText('Fictional data. Nothing here is saved or synced.')).toBeVisible();
    expect(headerAccount('Sign in')).toBeDisabled();
    await user.click(screen.getByRole('link', { name: 'Explore the rounds' }));
    expect(await screen.findByRole('heading', { name: /Five days/ })).toBeVisible();
    expect(within(screen.getByRole('list')).getAllByRole('listitem')).toHaveLength(5);
    await user.click(screen.getByRole('link', { name: 'Demo group' }));
    expect(await screen.findByRole('heading', { name: 'Meet the group.' })).toBeVisible();
    expect(within(screen.getByRole('list')).getAllByRole('listitem')).toHaveLength(12);
    await user.click(mainNavigation().getByRole('link', { name: 'The group' }));
    expect(await screen.findByRole('heading', { name: 'Event services are not configured' })).toBeVisible();
    expect(screen.queryByText('Fictional data. Nothing here is saved or synced.')).not.toBeInTheDocument();
  });

  it('connects main tabs and the saved scorecard to the explicitly opened event without loading catalog data', async () => {
    testServices = service();
    render(<App />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('link', { name: `Open ${fictionalEvent.name}` }));
    expect(headerAccount('Sign out')).toBeEnabled();
    expect(await screen.findByRole('heading', { name: fictionalEvent.name })).toBeVisible();
    const event = encodeURIComponent(fictionalEvent.id);
    expect(mainNavigation().getByRole('link', { name: 'Rounds' })).toHaveAttribute('href', `#rounds?event=${event}`);
    await user.click(mainNavigation().getByRole('link', { name: 'Rounds' }));
    await screen.findByRole('heading', { level: 1, name: 'Rounds' });
    expect(headerAccount('Sign out')).toBeEnabled();
    expect(screen.getByRole('main')).toHaveFocus();
    expect(document.title).toBe('Rounds | Perly Golf Max');
    expect(screen.getByText('Fictional Meadows')).toBeVisible();
    expect(screen.queryByText(/Five days|sample tee time/i)).not.toBeInTheDocument();
    await user.click(mainNavigation().getByRole('link', { name: 'The group' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'The Group' })).toBeVisible();
    expect(headerAccount('Sign out')).toBeEnabled();
    expect(screen.getByRole('region', { name: 'Event roster' })).toHaveTextContent('Fictional Player 1');
    const round = fictionalWorkspace.rounds[0];
    if (!round) throw new Error('Missing fictional round.');
    await user.click(screen.getByRole('link', { name: `Open scorecard for ${round.name}` }));
    expect(await screen.findByRole('heading', { name: 'Round scorecard' })).toBeVisible();
    expect(headerAccount('Sign out')).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Enter scores' }));
    expect(await screen.findByRole('form', { name: 'Group 1 hole 1 entry' })).toBeVisible();
    expect(headerAccount('Sign out')).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Games' }));
    expect(screen.getByRole('button', { name: 'Games' })).toHaveAttribute('aria-pressed', 'true');
    expect(headerAccount('Sign out')).toBeEnabled();
    expect(mainNavigation().getByRole('link', { name: 'Rounds' })).toHaveAttribute('aria-current', 'page');
    expect(testServices.scores.load).toHaveBeenCalledWith(fictionalEvent.id, round.id, expect.any(AbortSignal));
    expect(testServices.catalog.players).not.toHaveBeenCalled();
    expect(testServices.catalog.courses).not.toHaveBeenCalled();
    expect(testServices.session.initialize).toHaveBeenCalledOnce();
  });

  it('restores selected-event links on refresh, retains context through Events/Preview, and clears it on sign-out', async () => {
    testServices = service();
    navigate(`#rounds?event=${fictionalEvent.id}`);
    render(<App />);
    await screen.findByRole('heading', { level: 1, name: 'Rounds' });
    const user = userEvent.setup();
    await user.click(mainNavigation().getByRole('link', { name: 'Events' }));
    await screen.findByRole('heading', { name: 'Events' });
    expect(mainNavigation().getByRole('link', { name: 'Overview' })).toHaveAttribute('href', `#overview?event=${fictionalEvent.id}`);
    await user.click(screen.getByRole('link', { name: 'Preview' }));
    await screen.findByRole('heading', { name: 'The Coastal Classic' });
    await user.click(mainNavigation().getByRole('link', { name: 'The group' }));
    await screen.findByRole('heading', { name: 'The Group' });
    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    await screen.findByRole('button', { name: 'Sign in' });
    expect(window.location.hash).toBe('#events');
    expect(mainNavigation().getByRole('link', { name: 'Rounds' })).toHaveAttribute('href', '#rounds');
    expect(screen.queryByText('Fictional Player 1')).not.toBeInTheDocument();
    expect(testServices.session.signOut).toHaveBeenCalledOnce();
  });

  it('requires an explicit event choice rather than silently selecting the first available event', async () => {
    testServices = service();
    navigate('#overview');
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Choose an event' })).toBeVisible();
    expect(testServices.setup.load).not.toHaveBeenCalled();
    expect(screen.getByRole('link', { name: fictionalEvent.name })).toHaveAttribute('href', `#overview?event=${fictionalEvent.id}`);
    expect(screen.queryByText('The Coastal Classic')).not.toBeInTheDocument();
  });

  it('clears private selection and views on expired access without falling back to demo content', async () => {
    testServices = service();
    vi.mocked(testServices.setup.load).mockRejectedValueOnce(new SessionExpiredError('Sign in again.'));
    navigate(`#group?event=${fictionalEvent.id}`);
    render(<App />);
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeVisible();
    await waitFor(() => { expect(mainNavigation().getByRole('link', { name: 'The group' })).toHaveAttribute('href', '#group'); });
    expect(screen.queryByText('The Coastal Classic')).not.toBeInTheDocument();
    expect(screen.queryByText('Fictional Player 1')).not.toBeInTheDocument();
  });

  it('supports direct demo links and skip navigation without changing the route', async () => {
    navigate('#preview?view=group');
    render(<App />);
    expect(screen.getByRole('heading', { name: 'Meet the group.' })).toBeVisible();
    const user = userEvent.setup();
    await user.tab();
    expect(screen.getByRole('link', { name: 'Skip to content' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('main')).toHaveFocus();
    expect(window.location.hash).toBe('#preview?view=group');
    navigate('#missing');
    expect(await screen.findByRole('heading', { name: 'Events' })).toBeVisible();
  });

  it('initializes identity on Preview without fetching private event or catalog data and keeps the current header action after navigation', async () => {
    testServices = service();
    navigate('#preview');
    render(<App />);
    await screen.findByRole('button', { name: 'Sign out' });
    expect(headerAccount('Sign out')).toBeEnabled();
    expect(testServices.events.capabilities).not.toHaveBeenCalled();
    expect(testServices.events.list).not.toHaveBeenCalled();
    expect(testServices.catalog.courses).not.toHaveBeenCalled();
    const user = userEvent.setup();
    await user.click(mainNavigation().getByRole('link', { name: 'Events' }));
    await user.click(await screen.findByRole('link', { name: `Open ${fictionalEvent.name}` }));
    await screen.findByRole('heading', { name: fictionalEvent.name });
    await user.click(screen.getByRole('link', { name: 'Preview' }));
    await screen.findByRole('heading', { name: 'The Coastal Classic' });
    await user.click(headerAccount('Sign out'));
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeEnabled();
    expect(mainNavigation().getByRole('link', { name: 'Rounds' })).toHaveAttribute('href', '#rounds');
    expect(testServices.session.signOut).toHaveBeenCalledOnce();
    expect(testServices.session.initialize).toHaveBeenCalledOnce();
  });

  it('keeps signed-out Preview fictional and invokes only the existing sign-in action', async () => {
    testServices = service();
    vi.mocked(testServices.session.initialize).mockResolvedValue(false);
    navigate('#preview?view=group');
    render(<App />);
    await screen.findByRole('button', { name: 'Sign in' });
    const user = userEvent.setup();
    await user.tab();
    await user.tab();
    await user.tab();
    expect(headerAccount('Sign in')).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(testServices.session.signIn).toHaveBeenCalledOnce();
    expect(headerAccount('Sign in')).toBeEnabled();
    expect(screen.getByText('Fictional data. Nothing here is saved or synced.')).toBeVisible();
    expect(testServices.events.list).not.toHaveBeenCalled();
    expect(testServices.events.capabilities).not.toHaveBeenCalled();
  });

  it('hides the previous archived list while returning from Preview and consistently selects the fresh active list', async () => {
    const services = service();
    testServices = services;
    const archived = { ...fictionalEvent, name: 'Fictional Archived Trip', status: 'archived' } as const;
    let finish: ((page: EventPage) => void) | undefined;
    const pending = new Promise<EventPage>((resolve) => { finish = resolve; });
    vi.mocked(testServices.events.list)
      .mockResolvedValueOnce({ events: [fictionalEvent] })
      .mockResolvedValueOnce({ events: [archived] })
      .mockReturnValueOnce(pending);
    render(<App />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Archived events' }));
    await screen.findByRole('heading', { name: archived.name });
    expect(screen.getByRole('button', { name: 'Archived events' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('link', { name: 'Preview' }));
    await screen.findByRole('heading', { name: 'The Coastal Classic' });
    expect(testServices.events.list).toHaveBeenCalledTimes(2);
    await user.click(mainNavigation().getByRole('link', { name: 'Events' }));
    await waitFor(() => { expect(services.events.list).toHaveBeenCalledTimes(3); });
    expect(screen.getByText('Loading your events...')).toBeVisible();
    expect(screen.queryByRole('heading', { name: archived.name })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Archived events' })).not.toBeInTheDocument();
    expect(headerAccount('Sign out')).toBeEnabled();
    await act(async () => { finish?.({ events: [fictionalEvent] }); await pending; });
    expect(await screen.findByRole('heading', { name: fictionalEvent.name })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Active events' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Archived events' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByRole('heading', { name: archived.name })).not.toBeInTheDocument();
    expect(screen.queryByText(/Archived events are visible only/)).not.toBeInTheDocument();
    expect(testServices.events.list).toHaveBeenLastCalledWith(expect.any(AbortSignal));
    expect(testServices.events.list).toHaveBeenCalledTimes(3);
    expect(testServices.session.initialize).toHaveBeenCalledOnce();
  });

  it.each([
    ['#events?catalog=courses', 'Saved course catalog'],
    ['#events?catalog=players', 'Saved player catalog'],
    [`#events?event=${fictionalEvent.id}`, 'Event setup'],
  ])('keeps one header account control on %s', async (hash, heading) => {
    testServices = service();
    vi.mocked(testServices.events.capabilities).mockResolvedValue({ canCreateEvents: true, canManageCatalog: true });
    navigate(hash);
    render(<App />);
    await screen.findByRole('heading', { name: heading });
    expect(headerAccount('Sign out')).toBeEnabled();
    expect(within(screen.getByRole('main')).queryByRole('button', { name: /^Sign (in|out)$/ })).not.toBeInTheDocument();
  });
});
