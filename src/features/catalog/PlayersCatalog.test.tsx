import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { EventChangedError } from '../../client/events';
import { fakeCatalog, fictionalId, fictionalPlayers } from '../../client/catalog.test-support';
import { PlayersCatalog } from './PlayersCatalog';
import type { PlayerCatalogPage, PlayerIndexHistory } from '../../domain/catalog';

const player = fictionalPlayers[0];
if (!player) throw new Error('Missing fictional player.');
const observation = {
  id: fictionalId(200), value: '+1.2', effectiveDate: '2026-01-02', source: 'Fictional self-report',
  recordedAt: '2026-01-03T00:00:00Z', recordedBy: { tenantId: fictionalId(201), objectId: fictionalId(202) },
  previousObservationId: null,
};

describe('manager player catalog', () => {
  it('prevents refresh and creation while the initial catalog is pending, then preserves a confirmed newly created player', async () => {
    const client = fakeCatalog();
    let finish: ((page: PlayerCatalogPage) => void) | undefined;
    const initial = new Promise<PlayerCatalogPage>((resolve) => { finish = resolve; });
    vi.mocked(client.players).mockReturnValueOnce(initial);
    const created = { ...player, id: fictionalId(20), displayName: 'Fictional Additional Player' };
    vi.mocked(client.createPlayer).mockResolvedValue(created);
    const user = userEvent.setup();
    render(<PlayersCatalog client={client} />);
    const name = screen.getByLabelText('Player display name');
    expect(name).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Refresh player catalog' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Refresh player catalog' }));
    await user.type(name, created.displayName);
    await user.click(screen.getByRole('button', { name: 'Save player' }));
    expect(client.players).toHaveBeenCalledTimes(1);
    expect(client.createPlayer).not.toHaveBeenCalled();
    await act(async () => { finish?.({ players: fictionalPlayers }); await initial; });
    expect(name).toBeEnabled();
    await user.type(name, created.displayName);
    await user.click(screen.getByRole('button', { name: 'Save player' }));
    expect(await screen.findByRole('heading', { name: created.displayName })).toBeVisible();
    expect(screen.getByLabelText('Player display name')).toHaveValue('');
    expect(client.createPlayer).toHaveBeenCalledTimes(1);
  });

  it('keeps creation disabled after initial failure but allows a settled-error refresh to restore readiness', async () => {
    const client = fakeCatalog();
    let reject: ((reason: Error) => void) | undefined;
    const initial = new Promise<PlayerCatalogPage>((_resolve, fail) => { reject = fail; });
    vi.mocked(client.players).mockReturnValueOnce(initial);
    const user = userEvent.setup();
    render(<PlayersCatalog client={client} />);
    await act(async () => { reject?.(new Error('Initial player list failed.')); await initial.catch(() => undefined); });
    expect(await screen.findByRole('alert')).toHaveTextContent('Initial player list failed');
    expect(screen.getByLabelText('Player display name')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Refresh player catalog' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Refresh player catalog' }));
    await waitFor(() => { expect(screen.getByLabelText('Player display name')).toBeEnabled(); });
    expect(client.players).toHaveBeenCalledTimes(2);
  });

  it('settles initial history before accepting mutations, then keeps refreshed history and labels the prior audit pointer accurately', async () => {
    const client = fakeCatalog();
    let finish: ((history: PlayerIndexHistory) => void) | undefined;
    const initial = new Promise<PlayerIndexHistory>((resolve) => { finish = resolve; });
    const recorded = { ...observation, id: fictionalId(210), value: '+2.1', previousObservationId: observation.id };
    vi.mocked(client.history).mockReturnValueOnce(initial).mockResolvedValue({ observations: [recorded, observation] });
    vi.mocked(client.recordIndex).mockResolvedValue({ ...player, etag: 'player-v2', currentIndex: recorded });
    const user = userEvent.setup();
    render(<PlayersCatalog client={client} />);
    await user.click(await screen.findByRole('button', { name: 'Edit Fictional Player 1' }));
    expect(screen.getByLabelText('Manual source')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save player name' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Refresh player and history' })).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: /I confirm/ }));
    await user.click(screen.getByRole('button', { name: 'Save manual index' }));
    expect(client.recordIndex).not.toHaveBeenCalled();
    expect(client.history).toHaveBeenCalledTimes(1);
    await act(async () => { finish?.({ observations: [observation] }); await initial; });
    await user.type(screen.getByLabelText('Handicap index (explicit + supported)'), '+2.1');
    await user.type(screen.getByLabelText('Effective date'), '2026-01-02');
    await user.type(screen.getByLabelText('Manual source'), 'Fictional self-report');
    await user.click(screen.getByRole('checkbox', { name: /I confirm/ }));
    await user.click(screen.getByRole('button', { name: 'Save manual index' }));
    await screen.findByText(/Manual index observation saved/);
    expect(screen.getAllByText(/\+2.1 — effective/)).toHaveLength(2);
    expect(screen.getByText(/previous audit entry/)).toHaveTextContent(observation.id);
    expect(screen.queryByText(/; corrects /)).not.toBeInTheDocument();
    expect(client.history).toHaveBeenCalledTimes(2);
  });
  it('requires complete manual fields and preserves a failed rename before confirming a saved name', async () => {
    const client = fakeCatalog();
    vi.mocked(client.renamePlayer).mockRejectedValueOnce(new Error('Rename not confirmed.'))
      .mockResolvedValueOnce({ ...player, displayName: 'Fictional Revised', etag: 'player-v2' });
    const user = userEvent.setup();
    render(<PlayersCatalog client={client} />);
    await user.click(await screen.findByRole('button', { name: 'Edit Fictional Player 1' }));
    const name = screen.getByLabelText('Saved player name');
    await user.clear(name);
    await user.type(name, 'Fictional Revised');
    await user.click(screen.getByRole('button', { name: 'Save player name' }));
    await screen.findByText('Rename not confirmed.');
    expect(name).toHaveValue('Fictional Revised');
    await user.click(screen.getByRole('button', { name: 'Save player name' }));
    await screen.findByText(/Player name saved/);
    expect(screen.getByRole('heading', { name: 'Fictional Revised' })).toBeVisible();
    await user.click(screen.getByRole('checkbox', { name: /I confirm/ }));
    await user.click(screen.getByRole('button', { name: 'Save manual index' }));
    expect(client.recordIndex).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Handicap index (explicit + supported)')).toBeInvalid();
  });
  it('shows unknown indices, preserves failed creation drafts and request IDs, and clears only a confirmed save', async () => {
    const client = fakeCatalog();
    vi.mocked(client.createPlayer).mockRejectedValueOnce(new Error('Nothing was confirmed saved.'));
    const user = userEvent.setup();
    render(<PlayersCatalog client={client} />);
    expect(await screen.findAllByText('Current HI: Unknown')).toHaveLength(4);
    await user.type(screen.getByLabelText('Player display name'), 'Fictional Player 1');
    await user.click(screen.getByRole('button', { name: 'Save player' }));
    await screen.findByText('Nothing was confirmed saved.');
    expect(screen.getByLabelText('Player display name')).toHaveValue('Fictional Player 1');
    await user.click(screen.getByRole('button', { name: 'Save player' }));
    await screen.findByText(/Player saved. Handicap index is unknown/);
    expect(screen.getByLabelText('Player display name')).toHaveValue('');
    const calls = vi.mocked(client.createPlayer).mock.calls;
    expect(calls[0]?.[1]).toBe(calls[1]?.[1]);
  });

  it('requires dated manual source and explicit correction confirmation; records a plus index and audited history', async () => {
    const client = fakeCatalog();
    vi.mocked(client.recordIndex).mockResolvedValue({ ...player, currentIndex: observation, etag: 'player-v2' });
    vi.mocked(client.history).mockResolvedValueOnce({ observations: [] }).mockResolvedValue({ observations: [observation] });
    const user = userEvent.setup();
    render(<PlayersCatalog client={client} />);
    await user.click(await screen.findByRole('button', { name: 'Edit Fictional Player 1' }));
    expect(await screen.findByText('No handicap observations. Current index is unknown.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Save manual index' })).toBeDisabled();
    await user.type(screen.getByLabelText('Handicap index (explicit + supported)'), '+1.2');
    await user.type(screen.getByLabelText('Effective date'), '2026-01-02');
    await user.type(screen.getByLabelText('Manual source'), 'Fictional self-report');
    await user.click(screen.getByRole('checkbox', { name: /I confirm this manual observation/ }));
    await user.click(screen.getByRole('button', { name: 'Save manual index' }));
    await screen.findByText(/Manual index observation saved/);
    expect(client.recordIndex).toHaveBeenCalledWith(player,
      { value: '+1.2', effectiveDate: '2026-01-02', source: 'Fictional self-report' }, expect.any(String), expect.any(AbortSignal));
    expect(screen.getAllByText(/\+1.2 — effective/)).toHaveLength(2);
    expect(screen.getByText(/recorded by/)).toHaveTextContent(observation.recordedBy.objectId);
    expect(screen.getByText(/Captured round inputs do not automatically change/)).toBeVisible();
    expect(screen.getByRole('checkbox', { name: /I confirm/ })).not.toBeChecked();
  });

  it('retains failed index input, blocks stale writes until refresh, and preserves input against the new player revision', async () => {
    const client = fakeCatalog();
    vi.mocked(client.recordIndex).mockRejectedValueOnce(new EventChangedError('Player changed. Refresh first.'));
    const user = userEvent.setup();
    render(<PlayersCatalog client={client} />);
    await user.click(await screen.findByRole('button', { name: 'Edit Fictional Player 1' }));
    await user.type(screen.getByLabelText('Handicap index (explicit + supported)'), '12.3');
    await user.type(screen.getByLabelText('Effective date'), '2026-01-02');
    await user.type(screen.getByLabelText('Manual source'), 'Fictional manual report');
    await user.click(screen.getByRole('checkbox', { name: /I confirm/ }));
    await user.click(screen.getByRole('button', { name: 'Save manual index' }));
    await screen.findByRole('alert');
    expect(screen.getByRole('button', { name: 'Save manual index' })).toBeDisabled();
    vi.mocked(client.players).mockResolvedValue({ players: [{ ...player, etag: 'player-v2' }] });
    await user.click(screen.getByRole('button', { name: 'Refresh player and history' }));
    await screen.findByText(/Player revision and history refreshed/);
    expect(screen.getByLabelText('Handicap index (explicit + supported)')).toHaveValue('12.3');
    expect(screen.getByRole('checkbox', { name: /I confirm/ })).not.toBeChecked();
    await user.click(screen.getByRole('checkbox', { name: /I confirm/ }));
    await user.click(screen.getByRole('button', { name: 'Save manual index' }));
    await waitFor(() => { expect(client.recordIndex).toHaveBeenCalledTimes(2); });
    const calls = vi.mocked(client.recordIndex).mock.calls;
    expect(calls[1]?.[0].etag).toBe('player-v2');
    expect(calls[1]?.[2]).toBe(calls[0]?.[2]);
  });

  it('keeps rename and index controls locked until dependent history settles and aborts late responses', async () => {
    const client = fakeCatalog();
    let finish: ((value: { observations: [] }) => void) | undefined;
    const response = new Promise<{ observations: [] }>((resolve) => { finish = resolve; });
    vi.mocked(client.history).mockResolvedValueOnce({ observations: [] }).mockReturnValueOnce(response);
    const user = userEvent.setup();
    const { unmount } = render(<PlayersCatalog client={client} />);
    await user.click(await screen.findByRole('button', { name: 'Edit Fictional Player 1' }));
    await user.type(screen.getByLabelText('Handicap index (explicit + supported)'), '5');
    await user.type(screen.getByLabelText('Effective date'), '2026-01-02');
    await user.type(screen.getByLabelText('Manual source'), 'Fictional report');
    await user.click(screen.getByRole('checkbox', { name: /I confirm/ }));
    await user.click(screen.getByRole('button', { name: 'Save manual index' }));
    await waitFor(() => { expect(client.history).toHaveBeenCalledTimes(2); });
    expect(screen.getByRole('button', { name: 'Save player name' })).toBeDisabled();
    expect(screen.getByLabelText('Manual source')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Edit Fictional Player 2' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Close player editor' })).toBeDisabled();
    unmount();
    expect(vi.mocked(client.history).mock.calls[1]?.[1].aborted).toBe(true);
    await act(async () => { finish?.({ observations: [] }); await response; });
  });
});
