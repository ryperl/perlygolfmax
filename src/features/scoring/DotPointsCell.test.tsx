import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { churchyFixture } from '../../domain/churchy.test-support';
import { DotPointsCell } from './DotPointsCell';

describe('existing dot cell details', () => {
  it('opens on the unchanged value, shows saved breakdown and closes with Escape restoring focus', () => {
    const f = churchyFixture(), round = f.round(), card = f.cards[0];
    if (!card) throw new Error('Missing fictional card');
    const props = { game: { definition: f.game, result: round.games?.results[0] }, card, number: 1, text: 0, players: f.cards };
    render(<DotPointsCell {...props} />);
    const button = screen.getByRole('button', { name: /hole 1 dot breakdown/ });
    expect(button).toHaveTextContent('0');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(button);
    expect(screen.getByRole('dialog')).toHaveFocus();
    expect(screen.getByText(/Base/)).toHaveTextContent('Base 0 · Specials 0 · Total 0');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(button).toHaveFocus();
  });

  it('updates an open view from fresh data, distinguishes missing totals, and dismisses outside or on navigation', () => {
    const f = churchyFixture(), card = f.cards[0];
    if (!card) throw new Error('Missing fictional card');
    const props = { game: { definition: f.game, result: f.round().games?.results[0] }, card, number: 1, text: 0, players: f.cards };
    const view = render(<DotPointsCell {...props} />);
    fireEvent.click(screen.getByRole('button', { name: /dot breakdown/ }));
    view.rerender(<DotPointsCell {...props} game={{ definition: f.game, result: undefined }} />);
    expect(screen.getByRole('status')).toHaveTextContent('Saved breakdown unavailable');
    expect(screen.getByText(/Base/)).toHaveTextContent('Base — · Specials — · Total —');
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    const trigger = screen.getByRole('button', { name: /dot breakdown/ });
    fireEvent.click(trigger);
    fireEvent.scroll(window);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.scroll(screen.getByRole('dialog'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 10, 10, 10));
    fireEvent.scroll(window);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
