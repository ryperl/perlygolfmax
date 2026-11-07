import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { HandicapIndexBadge } from './HandicapIndexBadge';

describe('event player index badge', () => {
  it.each(['18.9', '0', '+2.1'])('shows the exact linked %s index without treating zero as missing', (value) => {
    render(<HandicapIndexBadge value={value} context="current" />);
    expect(screen.getByLabelText(`Current Handicap Index: ${value}`)).toHaveTextContent(`HI ${value}`);
  });
  it('distinguishes an authoritative missing index from an unavailable legacy projection', () => {
    const view = render(<HandicapIndexBadge value={null} context="captured" />);
    expect(screen.getByLabelText('No Handicap Index')).toHaveTextContent('NH');
    view.rerender(<HandicapIndexBadge value={undefined} context="captured" />);
    expect(screen.getByLabelText('Handicap Index unavailable')).toHaveTextContent('HI —');
  });
});
