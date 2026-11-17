import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DotsSettings } from './DotsSettings';
import type { DotsSetupDraft } from './DotsSettings';
import { dotsFixture } from './dots.test-support';

describe('Dots special mode compatibility', () => {
  it('disables incompatible specials and removes them only on an explicit change to an incompatible mode', () => {
    const f = dotsFixture();
    const onChange = vi.fn<(draft: DotsSetupDraft) => void>();
    function Editor() {
      const [draft, setDraft] = useState<DotsSetupDraft>({ dotsMode: 'individual', dotsSpecials: [{ kind: 'sandy', units: 2 }] });
      return <DotsSettings draft={draft} groups={f.round.groups} players={f.round.cards} wolves={[]}
        onChange={(patch) => { setDraft((previous) => ({ ...previous, ...patch })); onChange(patch); }} />;
    }
    render(<Editor />);
    expect(screen.getByLabelText('Sweep · Automatic')).toBeDisabled();
    expect(screen.getByLabelText('Assassin · Automatic')).toBeDisabled();
    expect(screen.getByText('Sweep requires a linked game with actual High and Low results.')).toBeVisible();
    expect(screen.getByText('Assassin requires partnered 2-v-2 play, not individual mode.')).toBeVisible();
    fireEvent.change(screen.getByLabelText('Dots mode'), { target: { value: 'fixed' } });
    expect(screen.getByLabelText('Assassin · Automatic')).toBeEnabled();
    expect(screen.getByLabelText('Sweep · Automatic')).toBeDisabled();
    fireEvent.click(screen.getByLabelText('Assassin · Automatic'));
    fireEvent.change(screen.getByLabelText('Dots mode'), { target: { value: 'linked' } });
    expect(screen.getByLabelText('Sweep · Automatic')).toBeEnabled();
    fireEvent.click(screen.getByLabelText('Sweep · Automatic'));
    fireEvent.change(screen.getByLabelText('Dots mode'), { target: { value: 'fixed' } });
    expect(onChange.mock.lastCall?.[0].dotsSpecials).toEqual([{ kind: 'sandy', units: 2 }, { kind: 'assassin', units: 1 }]);
    fireEvent.change(screen.getByLabelText('Dots mode'), { target: { value: 'individual' } });
    expect(onChange.mock.lastCall?.[0].dotsSpecials).toEqual([{ kind: 'sandy', units: 2 }]);
    expect(screen.getByLabelText('Sandy units')).toHaveValue(2);
  });

  it('retains incompatible loaded selections across rendering and unrelated edits for explicit review', () => {
    const f = dotsFixture();
    const onChange = vi.fn<(draft: DotsSetupDraft) => void>();
    const draft: DotsSetupDraft = { dotsMode: 'individual', stake: '1.00',
      dotsSpecials: [{ kind: 'sweep', units: 2 }, { kind: 'assassin', units: 3 }] };
    const props = { draft, groups: f.round.groups, players: f.round.cards, wolves: [], onChange };
    const view = render(<DotsSettings {...props} />);
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Sweep · Automatic')).toBeChecked();
    expect(screen.getByLabelText('Assassin · Automatic')).toBeChecked();
    expect(screen.getByLabelText('Sweep units')).toBeDisabled();
    expect(screen.getByLabelText('Assassin units')).toHaveValue(3);
    expect(screen.getAllByText(/This saved selection is retained for review/)).toHaveLength(2);
    fireEvent.change(screen.getByLabelText('USD per dot difference'), { target: { value: '0' } });
    expect(onChange).toHaveBeenLastCalledWith({ stake: '0' });
    view.rerender(<DotsSettings {...props} draft={{ ...draft, stake: '0' }} />);
    expect(screen.getByLabelText('Sweep · Automatic')).toBeChecked();
    expect(screen.getByLabelText('Assassin · Automatic')).toBeChecked();
    fireEvent.change(screen.getByLabelText('Dots mode'), { target: { value: 'individual' } });
    expect(onChange).toHaveBeenCalledOnce();
    fireEvent.change(screen.getByLabelText('Dots mode'), { target: { value: 'fixed' } });
    expect(onChange).toHaveBeenLastCalledWith({ dotsMode: 'fixed', dotsSpecials: [{ kind: 'assassin', units: 3 }] });
  });
});
