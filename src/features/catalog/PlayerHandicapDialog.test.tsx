import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { fakeCatalog, fakeSetup, fictionalId, fictionalPlayers, fictionalWorkspace } from '../../client/catalog.test-support';
import type { ManualIndexInput, PlayerProfile } from '../../domain/catalog';
import type { EventHandicapRefreshResult } from '../../domain/player-handicap-update';
import { PrivateRequestError } from '../../client/private-request';
import { PlayerHandicapDialog } from './PlayerHandicapDialog';

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
afterEach(() => { vi.useRealTimers(); });
const first = fictionalPlayers[0];
if (!first) throw new Error('Missing fictional player.');
const player: PlayerProfile = first;
function observed(input: ManualIndexInput, id: string): PlayerProfile {
  return { ...player, etag: 'player-v2', currentIndex: { ...input, id, recordedAt: '2026-01-02T00:00:00Z',
    recordedBy: { tenantId: fictionalId(501), objectId: fictionalId(502) }, previousObservationId: null } };
}
function deferred<T>() {
  let resolve: (value: T) => void = () => { throw new Error('Uninitialized promise'); };
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
function mount() {
  const client = fakeCatalog(), setup = fakeSetup(), onSaved = vi.fn(), onClose = vi.fn(), onSessionExpired = vi.fn();
  vi.mocked(setup.load).mockResolvedValue(fictionalWorkspace);
  vi.mocked(client.recordIndex).mockImplementation((_player, input, id) => Promise.resolve(observed(input, id)));
  const result: EventHandicapRefreshResult = { eventId: fictionalWorkspace.event.id, playerId: player.id,
    etag: 'event-v2', updatedRoundIds: [fictionalId(70)], completedRoundIds: [fictionalId(71)] };
  vi.mocked(client.refreshEventIndex).mockResolvedValue(result);
  const view = render(<PlayerHandicapDialog client={client} setup={setup} eventId={fictionalWorkspace.event.id}
    playerId={player.id} displayName={player.displayName} onSaved={onSaved} onClose={onClose} onSessionExpired={onSessionExpired} />);
  return { ...view, client, setup, onSaved, onClose, onSessionExpired, result };
}
async function enter(value = '+1.2') {
  const field = await screen.findByRole('textbox', { name: 'Handicap Index' });
  await waitFor(() => { expect(field).toBeEnabled(); });
  const user = userEvent.setup();
  await user.clear(field);
  await user.type(field, value);
  return { user, field };
}
describe('quick roster HI update', () => {
  it('offers only HI, writes today/GHIN, then updates this event from the exact acknowledged observation', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 0, 2, 23, 59));
    const view = mount();
    const { user, field } = await enter();
    expect(field).toHaveFocus();
    expect(screen.getAllByRole('textbox')).toHaveLength(1);
    expect(screen.queryByLabelText(/date|source/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save HI' }));
    await waitFor(() => { expect(view.onSaved).toHaveBeenCalledWith(view.result); });
    const observationId = vi.mocked(view.client.recordIndex).mock.calls[0]?.[2];
    expect(view.client.recordIndex).toHaveBeenCalledWith(player,
      { value: '+1.2', effectiveDate: '2026-01-02', source: 'GHIN' }, expect.any(String), expect.any(AbortSignal));
    expect(view.client.refreshEventIndex).toHaveBeenCalledWith(fictionalWorkspace.event.id, player.id, observationId,
      fictionalWorkspace.etag, expect.any(String), expect.any(AbortSignal));
    expect(view.client.players).not.toHaveBeenCalled();
    expect(view.client.history).not.toHaveBeenCalled();
  });
  it('keeps the operation pending through both acknowledgements, with no duplicate save or early success', async () => {
    const view = mount(), catalog = deferred<PlayerProfile>(), round = deferred<EventHandicapRefreshResult>();
    vi.mocked(view.client.recordIndex).mockReturnValueOnce(catalog.promise);
    vi.mocked(view.client.refreshEventIndex).mockReturnValueOnce(round.promise);
    const { user } = await enter('0');
    await user.click(screen.getByRole('button', { name: 'Save HI' }));
    expect(screen.getByRole('button', { name: 'Close' })).toBeDisabled();
    expect(view.client.refreshEventIndex).not.toHaveBeenCalled();
    expect(view.onSaved).not.toHaveBeenCalled();
    const call = vi.mocked(view.client.recordIndex).mock.calls[0];
    if (!call) throw new Error('Missing fictional observation call.');
    await act(async () => { catalog.resolve(observed(call[1], call[2])); await catalog.promise; });
    expect(screen.getByRole('button', { name: 'Close' })).toBeDisabled();
    expect(screen.getByRole('textbox')).toBeDisabled();
    expect(view.onSaved).not.toHaveBeenCalled();
    await act(async () => { round.resolve(view.result); await round.promise; });
    expect(view.onSaved).toHaveBeenCalledOnce();
    expect(view.client.recordIndex).toHaveBeenCalledOnce();
  });
  it('retains the original observation date and retry identity across midnight after an uncertain catalog save', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(2026, 0, 2, 23, 59));
    const view = mount();
    vi.mocked(view.client.recordIndex).mockRejectedValueOnce(new Error('Response lost'));
    const { user, field } = await enter();
    await user.click(screen.getByRole('button', { name: 'Save HI' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Player HI update was not confirmed');
    expect(field).toHaveValue('+1.2');
    vi.setSystemTime(new Date(2026, 0, 3, 0, 1));
    await user.click(screen.getByRole('button', { name: 'Retry update' }));
    await waitFor(() => { expect(view.onSaved).toHaveBeenCalledOnce(); });
    const calls = vi.mocked(view.client.recordIndex).mock.calls;
    expect(calls[0]?.slice(0, 3)).toEqual(calls[1]?.slice(0, 3));
    expect(calls[1]?.[1].effectiveDate).toBe('2026-01-02');
  });
  it('reports partial success and retries the same event update without saving another catalog observation', async () => {
    const view = mount();
    vi.mocked(view.client.refreshEventIndex).mockRejectedValueOnce(new PrivateRequestError(409, 'Event changed'));
    const { user, field } = await enter('12.4');
    await user.click(screen.getByRole('button', { name: 'Save HI' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Player HI saved; updates to unfinished rounds were not confirmed');
    expect(field).toHaveValue('12.4'); expect(field).toBeDisabled();
    expect(view.onSaved).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Retry update' }));
    await waitFor(() => { expect(view.onSaved).toHaveBeenCalledOnce(); });
    expect(view.client.recordIndex).toHaveBeenCalledOnce();
    const calls = vi.mocked(view.client.refreshEventIndex).mock.calls;
    expect(calls[0]?.slice(0, 5)).toEqual(calls[1]?.slice(0, 5));
  });
  it('reloads a conflict for explicit review and reuses the already-saved observation with a fresh event revision', async () => {
    const view = mount();
    vi.mocked(view.client.refreshEventIndex).mockRejectedValueOnce(new PrivateRequestError(409, 'Event changed'));
    const { user } = await enter('8.4');
    await user.click(screen.getByRole('button', { name: 'Save HI' }));
    await screen.findByRole('alert');
    const recorded = vi.mocked(view.client.recordIndex).mock.calls[0];
    if (!recorded) throw new Error('Missing fictional observation.');
    vi.mocked(view.client.player).mockResolvedValueOnce(observed(recorded[1], recorded[2]));
    vi.mocked(view.setup.load).mockResolvedValueOnce({ ...fictionalWorkspace, etag: 'fresh-event-v3' });
    await user.click(screen.getByRole('button', { name: 'Reload and review' }));
    expect(await screen.findByText(/Your entry is retained/)).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Retry update' }));
    await waitFor(() => { expect(view.onSaved).toHaveBeenCalledOnce(); });
    expect(view.client.recordIndex).toHaveBeenCalledOnce();
    const calls = vi.mocked(view.client.refreshEventIndex).mock.calls;
    expect(calls[1]?.[3]).toBe('fresh-event-v3');
    expect(calls[0]?.[4]).not.toBe(calls[1]?.[4]);
  });
  it('rejects invalid indices and does not apply an unexpected catalog acknowledgement to any round', async () => {
    const view = mount(), { user, field } = await enter('100.0');
    await user.click(screen.getByRole('button', { name: 'Save HI' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter a valid Handicap Index');
    expect(view.client.recordIndex).not.toHaveBeenCalled();
    await user.clear(field); await user.type(field, '0');
    vi.mocked(view.client.recordIndex).mockResolvedValueOnce(player);
    await user.click(screen.getByRole('button', { name: 'Save HI' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('A different current index was returned');
    expect(view.client.refreshEventIndex).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Retry update' })).toBeDisabled();
  });
  it('clears private input and reports loss of authority without ending public access itself', async () => {
    const view = mount();
    vi.mocked(view.client.refreshEventIndex).mockRejectedValueOnce(new PrivateRequestError(403, 'Manager access ended'));
    const { user, field } = await enter();
    await user.click(screen.getByRole('button', { name: 'Save HI' }));
    await waitFor(() => { expect(view.onSessionExpired).toHaveBeenCalledWith(expect.stringContaining('Manager access ended')); });
    expect(field).toHaveValue(''); expect(field).toBeDisabled();
    expect(view.onSaved).not.toHaveBeenCalled();
  });
  it('aborts on unmount and never follows a displaced acknowledgement with an event write', async () => {
    const view = mount(), saved = deferred<PlayerProfile>();
    vi.mocked(view.client.recordIndex).mockReturnValueOnce(saved.promise);
    const { user } = await enter();
    await user.click(screen.getByRole('button', { name: 'Save HI' }));
    const call = vi.mocked(view.client.recordIndex).mock.calls[0];
    if (!call) throw new Error('Missing fictional call.');
    view.unmount();
    expect(call[3].aborted).toBe(true);
    await act(async () => { saved.resolve(observed(call[1], call[2])); await saved.promise; });
    expect(view.client.refreshEventIndex).not.toHaveBeenCalled();
    expect(view.onSaved).not.toHaveBeenCalled();
  });
});
