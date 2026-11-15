import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CourseHandicap } from './CourseHandicap';

describe('shared course handicap display', () => {
  it.each([[5, '5'], [0, '0'], [-2, '+2']] as const)('shows server handicap %s without applying a game allowance', (value, label) => {
    render(<CourseHandicap value={{ playerId: 'fictional-player', courseHandicap: value }} className="entry-handicap" />);
    expect(screen.getByLabelText(`Course handicap: ${label}`)).toHaveTextContent(`CH ${label}`);
  });

  it('distinguishes no index from unavailable or legacy missing projections', () => {
    const view = render(<CourseHandicap value={{
      playerId: 'fictional-player', courseHandicap: null, unavailableReason: 'missing-handicap-index',
    }} className="scorecard-handicap" />);
    expect(screen.getByLabelText('No captured Handicap Index')).toHaveTextContent('NH');
    view.rerender(<CourseHandicap value={{
      playerId: 'fictional-player', courseHandicap: null, unavailableReason: 'missing-tee-ratings',
    }} className="scorecard-handicap" />);
    expect(screen.getByLabelText('Course handicap unavailable')).toHaveTextContent('CH —');
    view.rerender(<CourseHandicap value={undefined} className="scorecard-handicap" />);
    expect(screen.getByLabelText('Course handicap unavailable')).toHaveTextContent('CH —');
    expect(screen.queryByText('NH')).not.toBeInTheDocument();
  });
});
