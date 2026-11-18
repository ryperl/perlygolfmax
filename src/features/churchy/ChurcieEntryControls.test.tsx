import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { churchyV3Fixture } from '../../domain/churchy-v3.test-support';
import type { ChurchySpecialsV3 } from '../../domain/churchy';
import { ChurcieEntryControls } from './ChurcieEntryControls';

describe('Churchie default named category controls', () => {
  it('offers one group-level Blue Plate selector on par 5s and KP on par 3s without inferring an award', () => {
    const f = churchyV3Fixture(9, 1, 'tee');
    const round = { ...f.round(), layout: f.snapshot.teeProfile.holes.map((hole) => ({
      ...hole, par: hole.number === 2 ? 5 : hole.number === 3 ? 3 : 4,
    })) };
    const onChange = vi.fn<(record: ChurchySpecialsV3) => void>();
    const props = { round, game: f.game, saved: undefined, draft: undefined, disabled: false, onChange };
    const view = render(<ChurcieEntryControls {...props} holeNumber={1} />);
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    view.rerender(<ChurcieEntryControls {...props} holeNumber={2} />);
    expect(screen.getAllByRole('combobox', { name: 'Blue Plate result' })).toHaveLength(1);
    expect(screen.queryByRole('combobox', { name: 'KP result' })).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole('combobox', { name: 'Blue Plate result' }), { target: { value: f.ids[0] } });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ version: 3, number: 2,
      contests: [{ kind: 'blue-plate', status: 'awarded', winnerId: f.ids[0] }] }));
    view.rerender(<ChurcieEntryControls {...props} holeNumber={3} />);
    expect(screen.getAllByRole('combobox', { name: 'KP result' })).toHaveLength(1);
    expect(screen.queryByRole('combobox', { name: 'Blue Plate result' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox', { name: 'KP result' }), { target: { value: 'none' } });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ version: 3, number: 3,
      contests: [{ kind: 'kp', status: 'no-qualifier' }] }));
  });

  it('does not silently enable categories in an existing saved definition', () => {
    const f = churchyV3Fixture(9, 1, 'tee');
    const game = { ...f.game, specials: f.game.specials.filter((special) => special.kind !== 'kp' && special.kind !== 'blue-plate') };
    const round = { ...f.round(), layout: f.snapshot.teeProfile.holes.map((hole) => ({ ...hole, par: 3 })) };
    const onChange = vi.fn();
    const props = { round, game, saved: undefined, draft: undefined, disabled: false, onChange };
    const view = render(<ChurcieEntryControls {...props} holeNumber={1} />);
    expect(screen.queryByRole('combobox', { name: 'KP result' })).not.toBeInTheDocument();
    view.rerender(<ChurcieEntryControls {...props} round={{ ...round, layout: round.layout.map((hole) => ({ ...hole, par: 5 })) }} holeNumber={1} />);
    expect(screen.queryByRole('combobox', { name: 'Blue Plate result' })).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });
});
