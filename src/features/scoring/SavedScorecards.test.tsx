import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { fictionalChange, fictionalRoundScores, scoreResult } from '../../client/scoring.test-support';
import { SavedScorecards } from './SavedScorecards';

describe('secondary saved scorecards and audit disclosure', () => {
  it('keeps saved group order, incomplete recorded totals and a traditional individual scorecard secondary to entry', async () => {
    const round = scoreResult({ ...fictionalChange, after: { kind: 'picked-up', reportedStrokes: 7 } }).round;
    render(<SavedScorecards round={round} histories={new Map()} openHistories={new Set()} loadingHistory={null} busy={false}
      onToggle={vi.fn()} onClose={vi.fn()} onLoad={vi.fn()} onMore={vi.fn()} />);
    expect(screen.getAllByRole('article').map((card) => card.getAttribute('aria-label'))).toEqual(
      fictionalRoundScores.cards.map((card) => `${card.displayName} saved scorecard`),
    );
    const card = within(screen.getByRole('article', { name: 'Fictional Player 1 saved scorecard' }));
    expect(card.getByText(/Recorded strokes: 7 across 1\/9 recorded holes; 0 completed/)).toHaveTextContent('Incomplete');
    const recap = card.getByRole('region', { name: 'Fictional Player 1 full scorecard' });
    expect(recap).not.toBeVisible();
    await userEvent.setup().click(card.getByText('Full scorecard for Fictional Player 1'));
    expect(recap).toBeVisible();
    expect(recap).toHaveTextContent('X7');
    expect(recap).toHaveTextContent('Stroke index');
    expect(card.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Finalize/ })).not.toBeInTheDocument();
  });
  it('exposes an explicit close action independent of busy or cached history, with correct toggle relationships', async () => {
    const onToggle = vi.fn();
    const onClose = vi.fn();
    const onMore = vi.fn();
    const playerId = fictionalChange.playerId;
    const histories = new Map([[playerId, {
      changes: [{ ...fictionalChange, after: { kind: 'picked-up' as const, reportedStrokes: 7 } }], cursor: 'next',
    }]]);
    const props = { round: fictionalRoundScores, histories, openHistories: new Set([playerId]), loadingHistory: null, busy: false,
      onToggle, onClose, onLoad: vi.fn(), onMore };
    const { rerender } = render(<SavedScorecards {...props} />);
    const user = userEvent.setup();
    const toggle = screen.getByRole('button', { name: 'History for Fictional Player 1' });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(toggle).toHaveAttribute('aria-controls', `score-history-${playerId}`);
    expect(screen.getByRole('region', { name: 'Fictional Player 1 audit history' })).toHaveTextContent('X7 — picked up; 7 reported, incomplete');
    await user.click(screen.getByRole('button', { name: 'More history for Fictional Player 1' }));
    expect(onMore).toHaveBeenCalledWith(playerId);
    rerender(<SavedScorecards {...props} loadingHistory={playerId} busy />);
    await user.click(screen.getByRole('button', { name: 'Close history for Fictional Player 1' }));
    expect(onClose).toHaveBeenCalledWith(playerId);
    await user.click(toggle);
    expect(onToggle).toHaveBeenCalledWith(playerId);
    rerender(<SavedScorecards {...props} openHistories={new Set()} />);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('region', { name: 'Fictional Player 1 audit history' })).not.toBeInTheDocument();
  });
});
