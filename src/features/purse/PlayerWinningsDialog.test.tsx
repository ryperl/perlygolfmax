import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PublicPurseResults } from './PublicPurseResults';
import { fictionalPurse } from '../../../tests/smoke/purse-fixture-data';
import { publicPurseSummary } from '../../domain/public-purse';
import { playerWinningsBreakdown } from '../../domain/winnings-breakdown';
import type { PlayerWinningsBreakdown } from '../../domain/winnings-breakdown';

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
describe('lazy public winnings breakdown', () => {
  it('separates individual awards into labeled money rows and shows the saved pool subtotal', async () => {
    const value = fictionalPurse();
    const summary = publicPurseSummary(value);
    const first = summary.players[0];
    if (!first) throw new Error('Missing fixture');
    const saved = playerWinningsBreakdown(value, first.playerId);
    const award = saved?.awards[0];
    if (!saved || !award) throw new Error('Missing fixture award');
    const detail: PlayerWinningsBreakdown = { ...saved, awards: [{ ...award, poolName: 'Fictional KP',
      parts: [
        { kind: 'kp', amountMinor: 40, holeNumber: 1, distanceInches: 12, splitCount: 1, resolution: 'unique' },
        { kind: 'kp', amountMinor: 60, holeNumber: 7, distanceInches: 24, splitCount: 1, resolution: 'unique' },
      ],
    }] };
    render(<PublicPurseResults value={summary} loadPlayer={vi.fn().mockResolvedValue(detail)} />);
    await userEvent.click(screen.getByRole('button', { name: first.displayName }));
    const table = within(await screen.findByRole('table', { name: 'Allocated winnings by pool' }));
    expect(table.getByRole('columnheader', { name: 'Award / detail' })).toBeVisible();
    expect(table.getByRole('rowheader', { name: /Hole 1 · 1 ft 0 in/ })).toBeVisible();
    expect(table.getByRole('row', { name: /Hole 1 · 1 ft 0 in/ })).toHaveTextContent(/USD\s+0\.40/);
    expect(table.getByRole('row', { name: /Hole 7 · 2 ft 0 in/ })).toHaveTextContent(/USD\s+0\.60/);
    expect(table.getByRole('row', { name: /Pool subtotal/ })).toHaveTextContent(/USD\s+1\.00/);
  });
  it('keeps known zero winnings explicit without an empty details table', async () => {
    const value = fictionalPurse();
    const summary = publicPurseSummary(value);
    const player = summary.players.find((entry) => entry.amountMinor === 0);
    if (!player) throw new Error('Missing fictional nonwinner');
    const load = vi.fn().mockResolvedValue(playerWinningsBreakdown(value, player.playerId));
    render(<PublicPurseResults value={summary} loadPlayer={load} />);
    await userEvent.click(screen.getByRole('button', { name: player.displayName }));
    const dialog = within(screen.getByRole('dialog'));
    expect(await dialog.findByText('No allocated winnings.')).toBeVisible();
    expect(dialog.queryByRole('table')).not.toBeInTheDocument();
  });
  it('opens one selected player, explains actual awards, reports freshness and restores focus on Escape', async () => {
    const value = fictionalPurse();
    const summary = publicPurseSummary(value);
    const first = summary.players[0];
    if (!first) throw new Error('Missing fixture');
    const detail = playerWinningsBreakdown(value, first.playerId);
    const load = vi.fn().mockResolvedValue(detail);
    const user = userEvent.setup();
    render(<PublicPurseResults value={{ ...summary, players: summary.players.map((player) => ({ ...player, amountMinor: 0 })) }} loadPlayer={load} />);
    expect(load).not.toHaveBeenCalled();
    const button = screen.getByRole('button', { name: first.displayName });
    await user.click(button);
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByRole('heading', { level: 2 })).toHaveFocus();
    const table = within(await dialog.findByRole('table', { name: 'Allocated winnings by pool' }));
    expect(table.getByRole('columnheader', { name: 'Won' })).toBeVisible();
    expect(table.getByRole('row', { name: /Place 1/ })).toHaveTextContent(/USD\s+1\.00/);
    expect(table.queryByText('Pool subtotal')).not.toBeInTheDocument();
    expect(dialog.getByText(/Newer winnings are shown/)).toBeVisible();
    expect(load).toHaveBeenCalledWith(first.playerId, expect.any(AbortSignal));
    fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(button).toHaveFocus();
  });
  it('keeps failures explicit, retries only on request, and aborts/ignores closed-player responses', async () => {
    const value = fictionalPurse();
    const summary = publicPurseSummary(value);
    const first = summary.players[0];
    if (!first) throw new Error('Missing fixture');
    let resolve: ((value: PlayerWinningsBreakdown) => void) | undefined;
    const load = vi.fn<(playerId: string, signal: AbortSignal) => Promise<PlayerWinningsBreakdown>>()
      .mockRejectedValueOnce(new Error('Read failed'))
      .mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const user = userEvent.setup();
    render(<PublicPurseResults value={summary} loadPlayer={load} />);
    await user.click(screen.getByRole('button', { name: first.displayName }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Read failed');
    await user.click(screen.getByRole('button', { name: 'Refresh winnings' }));
    await user.click(screen.getByRole('button', { name: 'Close winnings' }));
    expect(load.mock.calls[1]?.[1].aborted).toBe(true);
    const detail = playerWinningsBreakdown(value, first.playerId);
    if (!detail) throw new Error('Missing fixture');
    await act(() => { resolve?.(detail); return Promise.resolve(); });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(load).toHaveBeenCalledTimes(2);
  });
});
