import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { EventSkinsPanel } from './EventSkinsPanel';
import { calculateEventSkins, calculateEventSkinsDetails } from '../../domain/event-skins';
import type { EventSkinsDetails } from '../../domain/event-skins-details';
import { eventSkinsFixture } from '../../domain/event-skins.test-support';
import { PrivateRequestError } from '../../client/private-request';

function fixture() {
  const f = eventSkinsFixture([{ kind: 'strokes', strokes: 3 }, { kind: 'strokes', strokes: 4 }], ['0', '18'], 2);
  return { value: { workspace: f.workspace, eventSkins: calculateEventSkins(f.workspace, f.rounds) },
    details: calculateEventSkinsDetails(f.workspace, f.rounds) };
}
describe('on-demand saved skins details', () => {
  it('does not resurface old private standings after detail access is denied', async () => {
    const f = fixture();
    const ended = vi.fn();
    render(<EventSkinsPanel value={f.value} loadDetails={vi.fn().mockRejectedValue(new PrivateRequestError(403, 'Access ended'))}
      onSessionExpired={vi.fn()} onAccessEnded={ended} />);
    await userEvent.click(screen.getByRole('button', { name: 'View skins details' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Access ended');
    expect(screen.getByRole('button', { name: 'Back to skins' })).toBeDisabled();
    expect(screen.queryByRole('list', { name: 'Event skins standings' })).not.toBeInTheDocument();
    expect(ended).toHaveBeenCalledWith('Access ended');
  });
  it('loads comparisons only on demand, filters all rounds without more requests and returns focus', async () => {
    const f = fixture();
    const load = vi.fn().mockResolvedValue(f.details);
    const user = userEvent.setup();
    render(<EventSkinsPanel value={f.value} loadDetails={load} onSessionExpired={vi.fn()} />);
    expect(load).not.toHaveBeenCalled();
    const trigger = screen.getByRole('button', { name: 'View skins details' });
    await user.click(trigger);
    expect(await screen.findByRole('heading', { name: 'Skins details' })).toHaveFocus();
    await screen.findByRole('combobox', { name: 'Round' });
    const table = within(screen.getByRole('table', { name: 'Hole 1 skins comparison' }));
    expect(table.getByRole('rowheader', { name: 'Fictional golfer 2' })).toBeVisible();
    expect(table.queryByRole('columnheader', { name: 'Outcome' })).not.toBeInTheDocument();
    expect(table.getByRole('columnheader', { name: 'Strokes received' })).toBeVisible();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Round' }), f.details.rounds[1]?.id ?? '');
    await user.click(screen.getByRole('button', { name: /^Hole 2:/ }));
    expect(screen.getByRole('table', { name: 'Hole 2 skins comparison' })).toBeVisible();
    expect(screen.queryByRole('table', { name: 'Hole 1 skins comparison' })).not.toBeInTheDocument();
    expect(load).toHaveBeenCalledOnce();
    await user.click(screen.getByRole('button', { name: 'Back to skins' }));
    expect(screen.getByRole('button', { name: 'View skins details' })).toHaveFocus();
  });
  it('preserves the selected round and hole through loading and failed refresh recovery', async () => {
    const f = fixture();
    const load = vi.fn().mockResolvedValue(f.details);
    const user = userEvent.setup();
    render(<EventSkinsPanel value={f.value} loadDetails={load} onSessionExpired={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'View skins details' }));
    const round = f.details.rounds[1];
    if (!round) throw new Error('Missing round');
    await user.selectOptions(await screen.findByRole('combobox', { name: 'Round' }), round.id);
    await user.click(screen.getByRole('button', { name: /^Hole 2:/ }));
    load.mockRejectedValueOnce(new Error('Fictional refresh failure'));
    await user.click(screen.getByRole('button', { name: 'Refresh skins details' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Fictional refresh failure');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Refresh skins details' }));
    expect(await screen.findByRole('table', { name: 'Hole 2 skins comparison' })).toBeVisible();
    expect(screen.getByRole('combobox', { name: 'Round' })).toHaveValue(round.id);
    expect(load).toHaveBeenCalledTimes(3);
  });
  it('aborts on back and ignores a late result; explicit refresh retries failures', async () => {
    const f = fixture();
    let resolve: ((value: EventSkinsDetails) => void) | undefined;
    const load = vi.fn<(signal: AbortSignal) => Promise<EventSkinsDetails>>()
      .mockImplementationOnce(() => new Promise((done) => { resolve = done; }))
      .mockRejectedValueOnce(new Error('Read failed'))
      .mockResolvedValue(f.details);
    const user = userEvent.setup();
    render(<EventSkinsPanel value={f.value} loadDetails={load} onSessionExpired={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'View skins details' }));
    await user.click(screen.getByRole('button', { name: 'Back to skins' }));
    expect(load.mock.calls[0]?.[0].aborted).toBe(true);
    await act(() => { resolve?.(f.details); return Promise.resolve(); });
    expect(screen.queryByRole('combobox', { name: 'Round' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'View skins details' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Read failed');
    await user.click(screen.getByRole('button', { name: 'Refresh skins details' }));
    expect(await screen.findByRole('combobox', { name: 'Round' })).toBeVisible();
  });
});
