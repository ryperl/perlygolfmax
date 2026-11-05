import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import type { EventServices } from './EventsPage';
import type * as EventsPageModule from './EventsPage';
import { fakeCatalog, fakeSetup, fictionalEvent, fictionalWorkspace, fictionalId } from '../client/catalog.test-support';
import { fakeScores } from '../client/scoring.test-support';
import { fakePublicServices } from '../client/public-events.test-support';
import { SessionExpiredError } from '../client/events';
import { PrivateRequestError } from '../client/private-request';
import { loadScoreLocation, saveScoreLocation, scoreLocationHref } from './score-resume';
import type { SavedScoreLocation } from '../domain/score-location';
import { isRecord } from '../contracts/events';
import { fictionalEventPurse } from '../client/purse.test-support';

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
    session: { initialize: vi.fn().mockResolvedValue(true), signIn: vi.fn().mockResolvedValue(undefined),
      signOut: vi.fn().mockResolvedValue(undefined), token: vi.fn().mockResolvedValue('fictional') },
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
const position: SavedScoreLocation = {
  version: 1, eventId: fictionalEvent.id, roundId: fictionalId(70), groupNumber: 2, holeNumber: 2, view: 'entry',
};

beforeAll(async () => {
  await Promise.all([import('./PublicEventsPage'), import('./EventsPage'), import('./PursePage')]);
});
beforeEach(() => {
  testServices = service();
  window.localStorage.clear();
  window.history.replaceState(null, '', '/');
});

describe('public app and organizer boundary', () => {
  it('starts on public Events with no account initialization or management controls', async () => {
    const services = fakePublicServices();
    render(<App publicServices={services} />);
    expect(await screen.findByRole('link', { name: `Open ${fictionalEvent.name}` })).toBeVisible();
    expect(testServices?.session.initialize).not.toHaveBeenCalled();
    expect(testServices?.events.list).not.toHaveBeenCalled();
    expect(testServices?.catalog.players).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /^Sign (in|out)$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Create event|Archive|Restore/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Course catalog' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Organizer tools' })).toHaveAttribute('href', '#organizer');
    expect(screen.queryByText('The Coastal Classic')).not.toBeInTheDocument();
  });

  it('treats a shared event URL as public rather than an organizer sign-in link', async () => {
    const services = fakePublicServices();
    navigate(`#events?event=${fictionalEvent.id}`);
    render(<App publicServices={services} />);
    expect(await screen.findByRole('heading', { name: fictionalEvent.name })).toBeVisible();
    expect(testServices?.session.initialize).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Sign in' })).not.toBeInTheDocument();
  });

  it('keeps event tabs, rounds, groups and score entry on the explicit public event without catalog reads', async () => {
    const services = fakePublicServices();
    const user = userEvent.setup();
    render(<App publicServices={services} />);
    await user.click(await screen.findByRole('link', { name: `Open ${fictionalEvent.name}` }));
    expect(await screen.findByRole('heading', { name: fictionalEvent.name })).toBeVisible();
    await user.click(mainNavigation().getByRole('link', { name: 'Rounds' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Rounds' })).toBeVisible();
    expect(document.title).toBe('Rounds | Perly Golf Max');
    await user.click(mainNavigation().getByRole('link', { name: 'The group' }));
    expect(await screen.findByRole('heading', { name: 'The Group' })).toBeVisible();
    const round = fictionalWorkspace.rounds[0];
    if (!round) throw new Error('Missing fictional round.');
    await user.click(screen.getByRole('link', { name: `Open scorecard for ${round.name}` }));
    expect(await screen.findByRole('form', { name: 'Group 1 hole 1 entry' })).toBeVisible();
    expect(services.scores.load).toHaveBeenCalledWith(fictionalEvent.id, round.id, expect.any(AbortSignal));
    expect(testServices?.session.initialize).not.toHaveBeenCalled();
    expect(testServices?.catalog.courses).not.toHaveBeenCalled();
    expect(screen.queryByRole('link', { name: 'Player invitations' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Configure event' })).not.toBeInTheDocument();
  });

  it('confirms Save & Next, preserves the group and resumes the next hole after a cold home-screen launch', async () => {
    const services = fakePublicServices();
    const user = userEvent.setup();
    navigate(`#events?event=${fictionalEvent.id}&round=${position.roundId}`);
    const first = render(<App publicServices={services} />);
    await screen.findByRole('form', { name: 'Group 1 hole 1 entry' });
    await user.selectOptions(screen.getByLabelText('View group'), '2');
    await user.type(screen.getByLabelText('Fictional Player 3 score'), '4');
    await user.type(screen.getByLabelText('Fictional Player 4 score'), '5');
    await user.click(screen.getByRole('button', { name: 'Save & Next Hole' }));
    expect(await screen.findByRole('form', { name: 'Group 2 hole 2 entry' })).toBeVisible();
    expect(screen.getByText(/^Saved —/)).toBeVisible();
    expect(loadScoreLocation().location).toEqual(position);
    expect(window.location.hash).toBe(scoreLocationHref(position));
    expect(screen.getByRole('main')).not.toHaveFocus();
    expect(screen.queryByRole('heading', { name: 'Round scorecard' })).not.toBeInTheDocument();
    const stored: unknown = JSON.parse(window.localStorage.getItem('perly-golf-max:last-score-location:v1') ?? '{}');
    if (!isRecord(stored)) throw new Error('Missing saved navigation.');
    const keys = Object.keys(stored).sort();
    expect(keys).toEqual(['eventId', 'groupNumber', 'holeNumber', 'roundId', 'version', 'view']);
    const reads = vi.mocked(services.scores.load).mock.calls.length;
    first.unmount();
    window.history.replaceState(null, '', '/');
    render(<App publicServices={services} />);
    expect(await screen.findByRole('form', { name: 'Group 2 hole 2 entry' })).toBeVisible();
    await waitFor(() => { expect(services.scores.load).toHaveBeenCalledTimes(reads + 1); });
    expect(services.events.list).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Fictional Player 3 score')).toHaveValue('');
    expect(testServices?.session.initialize).not.toHaveBeenCalled();
  });

  it('does not advance or mark Saved when a score write fails', async () => {
    const services = fakePublicServices();
    vi.mocked(services.scores.save).mockRejectedValueOnce(new PrivateRequestError(503, 'Connection failed.'));
    navigate(`#events?event=${position.eventId}&round=${position.roundId}`);
    render(<App publicServices={services} />);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Fictional Player 1 score'), '7');
    await user.click(screen.getByRole('button', { name: 'Save & Next Hole' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Connection failed.');
    expect(screen.getByRole('form', { name: 'Group 1 hole 1 entry' })).toBeVisible();
    expect(loadScoreLocation().location?.holeNumber).toBe(1);
    expect(screen.getByLabelText('Fictional Player 1 score')).toHaveValue('7');
    expect(screen.queryByText(/^Saved —/)).not.toBeInTheDocument();
  });

  it('keeps the explicit event chooser available instead of immediately reopening the remembered round', async () => {
    saveScoreLocation(position);
    const services = fakePublicServices();
    render(<App publicServices={services} />);
    await screen.findByRole('form', { name: 'Group 2 hole 2 entry' });
    await userEvent.setup().click(mainNavigation().getByRole('link', { name: 'Events' }));
    expect(await screen.findByRole('link', { name: `Open ${fictionalEvent.name}` })).toBeVisible();
    expect(window.location.hash).toBe('#events?choose=1');
    expect(screen.queryByRole('form')).not.toBeInTheDocument();
    expect(loadScoreLocation().location).toEqual(position);
  });

  it('clears unavailable public round recovery without sending the golfer to sign-in', async () => {
    saveScoreLocation(position);
    const services = fakePublicServices();
    vi.mocked(services.setup.load).mockRejectedValueOnce(new SessionExpiredError('Event no longer available.'));
    render(<App publicServices={services} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Event no longer available.');
    expect(loadScoreLocation().location).toBeNull();
    expect(screen.queryByRole('button', { name: 'Sign in' })).not.toBeInTheDocument();
    expect(screen.queryByText('The Coastal Classic')).not.toBeInTheDocument();
  });

  it('does not erase a newer different-event scoring place when an old tab loses access', async () => {
    const newer = { ...position, eventId: fictionalId(1000), roundId: fictionalId(1001) };
    saveScoreLocation(newer);
    const services = fakePublicServices();
    vi.mocked(services.setup.load).mockRejectedValueOnce(new SessionExpiredError('Old event archived.'));
    navigate(`#events?event=${position.eventId}&round=${position.roundId}`);
    render(<App publicServices={services} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Old event archived.');
    expect(loadScoreLocation().location).toEqual(newer);
  });

  it('shows explicit recovery warnings when navigation storage is blocked while keeping scoring usable', async () => {
    const services = fakePublicServices();
    const storage = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Storage blocked'); });
    navigate(`#events?event=${position.eventId}&round=${position.roundId}`);
    render(<App publicServices={services} />);
    try {
      await screen.findByRole('form', { name: 'Group 1 hole 1 entry' });
      expect(await screen.findByText(/scoring place could not be stored/)).toBeVisible();
      expect(screen.getByLabelText('Fictional Player 1 score')).toBeEnabled();
      expect(testServices?.session.initialize).not.toHaveBeenCalled();
    } finally { storage.mockRestore(); }
  });

  it.each(['tester', 'join'])('opens a legacy #%s link publicly and removes its secret without account work', async (page) => {
    const services = fakePublicServices();
    const secret = 'A'.repeat(43);
    window.history.replaceState(null, '', `#${page}?event=${fictionalEvent.id}&link=${fictionalId(801)}&token=${secret}`);
    render(<App publicServices={services} />);
    expect(await screen.findByRole('heading', { name: fictionalEvent.name })).toBeVisible();
    expect(window.location.hash).toBe(`#overview?event=${fictionalEvent.id}`);
    expect(window.location.href).not.toContain(secret);
    expect(document.body).not.toHaveTextContent(secret);
    expect(testServices?.session.initialize).not.toHaveBeenCalled();
    expect(window.localStorage.length).toBe(0);
  });

  it('publicly reads overall standings and winnings without exposing their configuration controls', async () => {
    const services = fakePublicServices();
    navigate(`#leaderboard?event=${fictionalEvent.id}`);
    render(<App publicServices={services} />);
    expect(await screen.findByRole('heading', { name: /not enabled/ })).toBeVisible();
    navigate(`#purse?event=${fictionalEvent.id}`);
    expect(await screen.findByRole('heading', { name: 'Event purse' })).toBeVisible();
    expect(services.purse.load).toHaveBeenCalledWith(fictionalEvent.id, expect.any(AbortSignal));
    expect(services.purse.save).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /Save prize|Add prize|Save purse/ })).not.toBeInTheDocument();
    expect(testServices?.session.initialize).not.toHaveBeenCalled();
  });

  it('keeps Preview fictional and private/public service-free, with skip navigation and explicit event selection', async () => {
    const services = fakePublicServices();
    navigate('#preview?view=group');
    render(<App publicServices={services} />);
    expect(screen.getByRole('heading', { name: 'Meet the group.' })).toBeVisible();
    expect(services.events.list).not.toHaveBeenCalled();
    expect(testServices?.session.initialize).not.toHaveBeenCalled();
    const user = userEvent.setup();
    await user.tab();
    expect(screen.getByRole('link', { name: 'Skip to content' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('main')).toHaveFocus();
    await user.click(mainNavigation().getByRole('link', { name: 'Rounds' }));
    expect(await screen.findByRole('heading', { name: 'Choose an event' })).toBeVisible();
    expect(screen.queryByText('The Coastal Classic')).not.toBeInTheDocument();
  });

  it('rejects invalid score routes without requesting cards', async () => {
    const services = fakePublicServices();
    navigate('#events?event=bad&round=bad');
    render(<App publicServices={services} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('invalid');
    expect(services.scores.load).not.toHaveBeenCalled();
    expect(services.setup.load).not.toHaveBeenCalled();
  });

  it('requires explicit organizer navigation before initializing identity and opens protected setup', async () => {
    const services = fakePublicServices();
    if (!testServices) throw new Error('Missing organizer fixture.');
    vi.mocked(testServices.events.capabilities).mockResolvedValue({ canCreateEvents: true, canManageCatalog: true });
    const user = userEvent.setup();
    render(<App publicServices={services} />);
    await screen.findByRole('link', { name: `Open ${fictionalEvent.name}` });
    await user.click(screen.getByRole('link', { name: 'Organizer tools' }));
    const open = await screen.findByRole('link', { name: `Open ${fictionalEvent.name}` });
    expect(testServices.session.initialize).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeVisible();
    expect(open).toHaveAttribute('href', `#organizer?event=${fictionalEvent.id}`);
    await user.click(open);
    expect(await screen.findByRole('heading', { name: 'Configure event setup' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Open public scoreboard' })).toBeVisible();
  });

  it('keeps organizer catalogs restricted and signs out to the public chooser', async () => {
    const services = fakePublicServices();
    navigate('#events?catalog=courses');
    render(<App publicServices={services} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Catalog access is restricted');
    expect(testServices?.catalog.courses).not.toHaveBeenCalled();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Sign out' }));
    expect(await screen.findByRole('link', { name: `Open ${fictionalEvent.name}` })).toBeVisible();
    expect(window.location.hash).toBe('#events?choose=1');
    expect(testServices?.session.signOut).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button', { name: /^Sign (in|out)$/ })).not.toBeInTheDocument();
  });

  it('keeps purse management in the organizer route rather than the unsigned public read adapter', async () => {
    const services = fakePublicServices();
    const purse = { load: vi.fn().mockResolvedValue(fictionalEventPurse()), save: vi.fn() };
    testServices = { ...service(), purse };
    navigate(`#organizer?event=${fictionalEvent.id}&view=purse`);
    render(<App publicServices={services} />);
    expect(await screen.findByRole('heading', { name: 'Event purse' })).toBeVisible();
    expect(purse.load).toHaveBeenCalledWith(fictionalEvent.id, expect.any(AbortSignal));
    expect(services.purse.load).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeVisible();
  });

  it('processes the organizer identity callback instead of restoring public scoring over it', async () => {
    saveScoreLocation(position);
    window.history.replaceState(null, '', '/?event-auth=1#code=fictional&state=fictional');
    render(<App publicServices={fakePublicServices()} />);
    expect(await screen.findByRole('button', { name: 'Sign out' })).toBeVisible();
    expect(testServices?.session.initialize).toHaveBeenCalledOnce();
    expect(window.location.hash).not.toContain('round=');
    expect(screen.queryByRole('form', { name: 'Group 2 hole 2 entry' })).not.toBeInTheDocument();
  });
});
