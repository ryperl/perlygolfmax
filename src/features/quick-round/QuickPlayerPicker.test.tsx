import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { QuickPlayerPicker } from './QuickPlayerPicker';

const players = Array.from({ length: 15 }, (_, index) => ({
  id: `fictional-player-${String(index)}`, displayName: `Fictional Golfer ${String(index + 1).padStart(2, '0')}`,
}));

describe('compact Quick golfer picker', () => {
  it('keeps fifteen saved golfers one tap away without paging, and preserves selections across close and search', () => {
    function Fixture() {
      const [ids, setIds] = useState<readonly string[]>([]);
      return <QuickPlayerPicker players={players} selectedIds={ids} disabled={false}
        onToggle={(id) => { setIds((values) => values.includes(id) ? values.filter((value) => value !== id) : [...values, id]); }} />;
    }
    render(<Fixture />);
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add golfers' }));
    expect(screen.getAllByRole('checkbox')).toHaveLength(15);
    expect(screen.queryByRole('button', { name: 'Next golfers' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Fictional Golfer 12'));
    fireEvent.click(screen.getByLabelText('Fictional Golfer 03'));
    expect(screen.getByText('2 selected · 15 saved golfers')).toBeVisible();
    expect(screen.getAllByRole('checkbox').slice(0, 2).map((input) => input.getAttribute('aria-label') ?? input.parentElement?.textContent))
      .toEqual(['Fictional Golfer 03', 'Fictional Golfer 12']);
    fireEvent.change(screen.getByLabelText('Find saved golfers'), { target: { value: 'Golfer 15' } });
    expect(screen.getAllByRole('checkbox')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Done choosing golfers' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add golfers' }));
    expect(screen.getByLabelText('Find saved golfers')).toHaveValue('Golfer 15');
    fireEvent.change(screen.getByLabelText('Find saved golfers'), { target: { value: '' } });
    expect(screen.getByLabelText('Fictional Golfer 12')).toBeChecked();
    expect(screen.getByLabelText('Fictional Golfer 03')).toBeChecked();
  });

  it('uses a bounded complete-directory search and paging without dropping off-page selected identities', () => {
    const many = Array.from({ length: 50 }, (_, index) => ({
      id: `fictional-${String(index)}`, displayName: `Fictional Zulu${String(index).padStart(2, '0')}`,
    }));
    const toggle = vi.fn();
    render(<QuickPlayerPicker players={many} selectedIds={['fictional-49']} disabled={false} onToggle={toggle} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add golfers' }));
    expect(screen.getAllByRole('checkbox')).toHaveLength(24);
    expect(screen.getAllByRole('checkbox')[0]).toHaveAccessibleName('Fictional Zulu49');
    fireEvent.click(screen.getByRole('button', { name: 'Next golfers' }));
    expect(screen.getByText('Page 2 of 3')).toBeVisible();
    fireEvent.change(screen.getByLabelText('Find saved golfers'), { target: { value: 'Zulu48' } });
    fireEvent.click(screen.getByLabelText('Fictional Zulu48'));
    expect(toggle).toHaveBeenCalledWith('fictional-48');
    expect(screen.getByText('1 selected · 1 matching golfer')).toBeVisible();
    fireEvent.change(screen.getByLabelText('Find saved golfers'), { target: { value: 'not found' } });
    expect(screen.getByText('No saved golfers match.')).toBeVisible();
  });

  it('never allows disabled or locked setup to change selections', () => {
    const toggle = vi.fn();
    const view = render(<QuickPlayerPicker players={players} selectedIds={[]} disabled={false} onToggle={toggle} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add golfers' }));
    view.rerender(<QuickPlayerPicker players={players} selectedIds={[]} disabled onToggle={toggle} />);
    expect(screen.getByRole('button', { name: 'Done choosing golfers' })).toBeDisabled();
    expect(screen.getByLabelText('Find saved golfers')).toBeDisabled();
    expect(screen.getAllByRole('checkbox').every((input) => input.hasAttribute('disabled'))).toBe(true);
    expect(toggle).not.toHaveBeenCalled();
  });
});
