import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PlayerName } from './PlayerName';

describe('compact player names', () => {
  it('keeps the full name as the text and accessible name, with initials for narrow screens', () => {
    render(<table><tbody><tr><th scope="row"><PlayerName name="Rory Pine" initials="RP" /></th></tr></tbody></table>);
    const header = screen.getByRole('rowheader', { name: 'Rory Pine' });
    expect(header).toHaveTextContent(/^Rory Pine$/);
    expect(header.querySelector('[data-initials]')).toHaveAttribute('data-initials', 'RP');
  });

  it('shows only the full name when no initials are known', () => {
    const { container } = render(<p><PlayerName name="Rory Pine" initials={undefined} /></p>);
    expect(screen.getByText('Rory Pine')).toBeInTheDocument();
    expect(container.querySelector('[data-initials]')).toBeNull();
  });
});
