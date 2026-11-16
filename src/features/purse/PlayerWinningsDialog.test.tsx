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
    expect(await dialog.findByText(/Place 1 · USD\s+1\.00/)).toBeVisible();
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
