import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { fakeCatalog, fakeSetup, fictionalId, fictionalPlayers } from '../client/catalog.test-support';
import { fakePublicServices, fictionalPublicWorkspace } from '../client/public-events.test-support';
import { fakeScores } from '../client/scoring.test-support';
import type { EventServices } from './EventsPage';
import { PrivateRequestError } from '../client/private-request';
import { PublicGroupPage } from './PublicGroupPage';

beforeAll(() => {
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: { configurable: true, value(this: HTMLDialogElement) { this.setAttribute('open', ''); } },
    close: { configurable: true, value(this: HTMLDialogElement) { this.removeAttribute('open'); } },
  });
});
afterAll(() => {
  Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal');
  Reflect.deleteProperty(HTMLDialogElement.prototype, 'close');
});
function organizer(canManageCatalog = true, supported: boolean | 'missing' = true, signedIn = true): EventServices {
  return { catalog: fakeCatalog(), setup: fakeSetup(), scores: fakeScores(),
    session: { initialize: vi.fn().mockResolvedValue(signedIn), token: vi.fn(),
      signIn: vi.fn(), signOut: vi.fn() },
    events: { capabilities: vi.fn().mockResolvedValue({ canCreateEvents: true, canManageCatalog,
      ...(supported === 'missing' ? {} : { playerHandicapUpdatesSupported: supported }) }),
      list: vi.fn(), create: vi.fn(), setStatus: vi.fn() } };
}
describe('public group protected HI access', () => {
  it.each([
    ['signed out', false, true, true], ['ordinary signed-in viewer', true, false, true],
    ['older API', true, true, 'missing'], ['disabled capability', true, true, false],
  ] as const)('keeps %s readonly without private catalog scans or interactive sign-in', async (_label, signedIn, manager, supported) => {
    const services = fakePublicServices(), privateServices = organizer(manager, supported, signedIn);
    render(<PublicGroupPage services={services} eventId={fictionalPublicWorkspace.event.id}
      onUnavailable={vi.fn()} organizer={privateServices} />);
    await screen.findByRole('heading', { level: 1, name: 'The Group' });
    await waitFor(() => { expect(privateServices.session.initialize).toHaveBeenCalledOnce(); });
    if (signedIn) await waitFor(() => { expect(privateServices.events.capabilities).toHaveBeenCalledOnce(); });
    expect(screen.queryByRole('button', { name: /Update Handicap Index for/ })).not.toBeInTheDocument();
    expect(privateServices.session.signIn).not.toHaveBeenCalled();
    expect(privateServices.catalog.players).not.toHaveBeenCalled();
    expect(privateServices.catalog.player).not.toHaveBeenCalled();
    expect(privateServices.events.list).not.toHaveBeenCalled();
  });
  it('lets a verified manager use a single-field editor and reloads the event only after both writes acknowledge', async () => {
    const services = fakePublicServices(), privateServices = organizer(), profile = fictionalPlayers[0];
    if (!profile) throw new Error('Missing fictional player.');
    vi.mocked(privateServices.catalog.recordIndex).mockImplementation((_player, input, id) => Promise.resolve({
      ...profile, etag: 'profile-v2', currentIndex: { ...input, id, recordedAt: '2026-01-02T00:00:00Z',
        previousObservationId: null, recordedBy: { tenantId: fictionalId(501), objectId: fictionalId(502) } },
    }));
    render(<PublicGroupPage services={services} eventId={fictionalPublicWorkspace.event.id}
      onUnavailable={vi.fn()} organizer={privateServices} />);
    const user = userEvent.setup();
    const edit = await screen.findByRole('button', { name: `Update Handicap Index for ${profile.displayName}` });
    await user.click(edit);
    const input = await screen.findByRole('textbox', { name: 'Handicap Index' });
    await waitFor(() => { expect(input).toBeEnabled(); });
    await user.type(input, '8.4');
    await user.click(screen.getByRole('button', { name: 'Save HI' }));
    await screen.findByText('HI saved. Completed rounds unchanged.');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => { expect(screen.getByRole('button', { name: edit.getAttribute('aria-label') ?? '' })).toHaveFocus(); });
    expect(privateServices.catalog.recordIndex).toHaveBeenCalledOnce();
    expect(privateServices.catalog.refreshEventIndex).toHaveBeenCalledOnce();
    expect(services.setup.load).toHaveBeenCalledTimes(3);
    expect(services.scores.save).not.toHaveBeenCalled();
  });
  it('ends private editing on lost authority but keeps public event access usable', async () => {
    const services = fakePublicServices(), privateServices = organizer(), onUnavailable = vi.fn();
    vi.mocked(privateServices.catalog.player).mockRejectedValueOnce(new PrivateRequestError(403, 'Manager access ended'));
    render(<PublicGroupPage services={services} eventId={fictionalPublicWorkspace.event.id}
      onUnavailable={onUnavailable} organizer={privateServices} />);
    const user = userEvent.setup();
    const profile = fictionalPlayers[0];
    if (!profile) throw new Error('Missing fictional player.');
    await user.click(await screen.findByRole('button', { name: `Update Handicap Index for ${profile.displayName}` }));
    expect(await screen.findByRole('alert')).toHaveTextContent('HI editing unavailable');
    expect(screen.getByRole('heading', { level: 1, name: 'The Group' })).toBeVisible();
    expect(screen.queryByRole('button', { name: /Update Handicap Index for/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(onUnavailable).not.toHaveBeenCalled();
    expect(services.setup.load).toHaveBeenCalled();
  });
});
