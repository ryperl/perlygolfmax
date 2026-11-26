import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DotsPlayingGroupSelect, DotsSettings } from './DotsSettings';
import type { DotsSetupDraft } from './DotsSettings';
import { dotsFixture } from './dots.test-support';
import type { NinesGameDefinition } from '../../domain/nines';
import { strokeGameId } from '../../domain/stroke-games.test-support';

/** A fictional group of three with a Nines game at $1.00 per point. */
function trioSetup() {
  const f = dotsFixture();
  const trio = f.ids.slice(0, 3);
  const groups = [{ number: 1, playerIds: trio }];
  const nines: NinesGameDefinition = { id: strokeGameId(990), name: 'Fictional Nines', kind: 'nines', version: 1,
    basis: 'gross', groupNumber: 1, playerIds: trio, stakeMinor: 100 };
  return { f, trio, groups, nines };
}

/** Renders Dots setup for the group of three and keeps the draft as a real form would. */
function renderTrioEditor(ninesLinkSupported: boolean, initial: DotsSetupDraft = {}) {
  const { f, trio, groups, nines } = trioSetup();
  const changes = vi.fn<(patch: DotsSetupDraft) => void>();
  function Editor() {
    const [draft, setDraft] = useState<DotsSetupDraft>({ groupNumber: 1, dotsPlayers: trio, dotsPlayerIds: trio,
      dotsMode: 'individual', ...initial });
    return <DotsSettings draft={draft} groups={groups} players={f.round.cards} wolves={[]} nines={[nines]}
      ninesLinkSupported={ninesLinkSupported} individualPlayerCounts={[1, 2, 3, 4]} existing={false}
      onChange={(patch) => { setDraft((current) => ({ ...current, ...patch })); changes(patch); }} />;
  }
  render(<Editor />);
  return { changes, nines };
}

describe('Dots linked to Nines setup', () => {
  it('lets a group of three link to its Nines game and shows the shared Nines rate', () => {
    const { changes, nines } = renderTrioEditor(true);
    expect(screen.getByRole('option', { name: 'Link to Nines' })).toBeEnabled();
    fireEvent.change(screen.getByLabelText('Dots mode'), { target: { value: 'linked' } });
    expect(changes.mock.lastCall?.[0]).toMatchObject({ dotsMode: 'linked' });
    fireEvent.change(screen.getByLabelText('Linked game'), { target: { value: nines.id } });
    expect(screen.getByText(/^Nines: each golfer plays alone · USD\s1\.00 per point difference$/u)).toBeVisible();
    expect(screen.queryByLabelText('USD per dot difference')).not.toBeInTheDocument();
  });

  it('keeps partner modes and the Nines link closed when the API cannot link Dots to Nines', () => {
    renderTrioEditor(false);
    expect(screen.getByRole('option', { name: 'Link to earned Wolf' })).toBeDisabled();
    expect(screen.queryByRole('option', { name: 'Link to Nines' })).not.toBeInTheDocument();
  });

  it('uses individual special rules, so Assassin cannot be chosen', () => {
    renderTrioEditor(true, { dotsMode: 'linked' });
    expect(screen.getByRole('checkbox', { name: /^Assassin/u })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: /^Birdie/u })).toBeEnabled();
  });

  it('drops Assassin when the Nines game is chosen as the link', () => {
    const { changes, nines } = renderTrioEditor(true, { dotsMode: 'linked',
      dotsSpecials: [{ kind: 'birdie', units: 1 }, { kind: 'assassin', units: 1 }] });
    fireEvent.change(screen.getByLabelText('Linked game'), { target: { value: nines.id } });
    expect(changes.mock.lastCall?.[0]).toEqual({ linkedGameId: nines.id, dotsSpecials: [{ kind: 'birdie', units: 1 }] });
  });
});

describe('Dots playing group for a Nines link', () => {
  it('offers a group of three in linked mode only when the Nines link is supported', () => {
    const { trio, groups } = trioSetup();
    const onChange = vi.fn<(patch: DotsSetupDraft) => void>();
    const draft: DotsSetupDraft = { dotsMode: 'linked' };
    const view = render(<DotsPlayingGroupSelect draft={draft} groups={groups} onChange={onChange} />);
    expect(screen.queryByRole('option', { name: /Group 1/u })).not.toBeInTheDocument();
    view.rerender(<DotsPlayingGroupSelect draft={draft} groups={groups} onChange={onChange} ninesLinkSupported />);
    fireEvent.change(screen.getByLabelText('Dots playing group'), { target: { value: '1' } });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ groupNumber: 1, dotsPlayerIds: trio }));
  });
});
