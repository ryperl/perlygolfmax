import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ChurcieOrderControls } from './ChurcieOrderControls';

const players = ['A', 'B', 'C', 'D'].map((playerId) => ({ playerId, displayName: `Fictional golfer ${playerId}` }));
const circuit = [10, 11, 12, 13, 14, 15, 16, 17, 18, 1, 2, 3, 4, 5, 6, 7, 8, 9];

describe('Churchie starting order', () => {
  it('uses three approach choices and the remaining golfer, previewing the confirmed three-part rotation', () => {
    const onChange = vi.fn<(ids: readonly string[]) => void>();
    function Editor() {
      const [value, setValue] = useState<readonly string[]>([]);
      return <ChurcieOrderControls mode="approach" value={value} players={players} circuit={circuit} disabled={false}
        onChange={(ids) => { setValue(ids); onChange(ids); }} />;
    }
    render(<Editor />);
    expect(screen.getByRole('heading')).toHaveTextContent('after approaches on hole 10');
    expect(screen.getByText(/Partners pending/)).toBeVisible();
    fireEvent.change(screen.getByLabelText('Closest approach'), { target: { value: 'A' } });
    fireEvent.change(screen.getByLabelText('Farthest approach'), { target: { value: 'D' } });
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Next farthest approach'), { target: { value: 'C' } });
    expect(onChange).toHaveBeenLastCalledWith(['A', 'B', 'C', 'D']);
    expect(screen.getByText('Remaining golfer: Fictional golfer B')).toBeVisible();
    fireEvent.click(screen.getByText('Preview partner rotation'));
    const rows = screen.getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('Holes 10, 11, 12Fictional golfer A + Fictional golfer D vs Fictional golfer B + Fictional golfer C');
    expect(rows[1]).toHaveTextContent('Holes 13, 14, 15Fictional golfer A + Fictional golfer C vs Fictional golfer B + Fictional golfer D');
    expect(rows[2]).toHaveTextContent('Holes 16, 17, 18Fictional golfer A + Fictional golfer B vs Fictional golfer C + Fictional golfer D');
    fireEvent.click(screen.getByRole('button', { name: 'Reset unsaved order' }));
    expect(onChange).toHaveBeenLastCalledWith([]);
    expect(screen.getByText(/Partners pending/)).toBeVisible();
  });

  it('swaps manual tee positions instead of duplicating a selected golfer', () => {
    const onChange = vi.fn();
    render(<ChurcieOrderControls mode="tee" value={['A', 'B', 'C', 'D']} players={players} circuit={circuit} disabled={false} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Churchie P1'), { target: { value: 'D' } });
    expect(onChange).toHaveBeenCalledWith(['D', 'B', 'C', 'A']);
  });

  it('never edits an acknowledged order and marks late recovery without exposing editable selects', () => {
    render(<ChurcieOrderControls mode="approach" value={['A', 'D', 'C', 'B']} players={players} circuit={circuit}
      saved late disabled={false} onChange={vi.fn()} />);
    expect(screen.getByText('Churchie partners · Order recorded late').closest('details')).not.toHaveAttribute('open');
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('keeps unavailable saved order explicit instead of guessing pairs from roster order', () => {
    render(<ChurcieOrderControls mode="approach" value={['A', 'A', 'C', 'D']} players={players} circuit={circuit}
      saved disabled={false} onChange={vi.fn()} />);
    fireEvent.click(screen.getByText('Churchie partners'));
    expect(screen.getByRole('alert')).toHaveTextContent('Saved partner order is unavailable');
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });
});
