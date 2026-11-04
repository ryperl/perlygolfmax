import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import type { EventServices } from './EventsPage';
import type * as EventsPageModule from './EventsPage';
import { fakeCatalog, fakeSetup, fictionalEvent, fictionalWorkspace } from '../client/catalog.test-support';
import { fakeScores } from '../client/scoring.test-support';
import { SessionExpiredError } from '../client/events';

let testServices: EventServices | undefined;
vi.mock('./EventsPage', async (importOriginal) => {
  const actual = await importOriginal<typeof EventsPageModule>();
  return { ...actual, ConfiguredEventsPage: ({ onSignedOut }: { readonly onSignedOut?: () => void }) =>
    <actual.EventsPage services={testServices} onSignedOut={onSignedOut} /> };
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
beforeEach(() => {
  testServices = undefined;
  window.history.replaceState(null, '', '/');
});

describe('App', () => {
  it('starts on Events and keeps fictional data behind the explicit Preview link', async () => {
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Events' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Event services are not configured' })).toBeVisible();
    expect(screen.queryByText('The Coastal Classic')).not.toBeInTheDocument();
    expect(screen.queryByText('12 golfers / 5 rounds')).not.toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole('link', { name: 'Preview' }));
    expect(await screen.findByRole('heading', { name: 'The Coastal Classic' })).toBeVisible();
    expect(screen.getByText('Fictional data. Nothing here is saved or synced.')).toBeVisible();
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
    expect(await screen.findByRole('heading', { name: fictionalEvent.name })).toBeVisible();
    const event = encodeURIComponent(fictionalEvent.id);
    expect(mainNavigation().getByRole('link', { name: 'Rounds' })).toHaveAttribute('href', `#rounds?event=${event}`);
    await user.click(mainNavigation().getByRole('link', { name: 'Rounds' }));
    await screen.findByRole('heading', { level: 1, name: 'Rounds' });
    expect(screen.getByRole('main')).toHaveFocus();
    expect(document.title).toBe('Rounds | Perly Golf Max');
    expect(screen.getByText('Fictional Meadows')).toBeVisible();
    expect(screen.queryByText(/Five days|sample tee time/i)).not.toBeInTheDocument();
    await user.click(mainNavigation().getByRole('link', { name: 'The group' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'The Group' })).toBeVisible();
    expect(screen.getByRole('region', { name: 'Event roster' })).toHaveTextContent('Fictional Player 1');
    const round = fictionalWorkspace.rounds[0];
    if (!round) throw new Error('Missing fictional round.');
    await user.click(screen.getByRole('link', { name: `Open scorecard for ${round.name}` }));
    expect(await screen.findByRole('heading', { name: 'Round scorecard' })).toBeVisible();
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
    expect(mainNavigation().getByRole('link', { name: 'The group' })).toHaveAttribute('href', '#group');
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
});
