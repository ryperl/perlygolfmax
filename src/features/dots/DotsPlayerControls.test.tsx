import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { DotsGameDefinition, DotsPlayerDeclaration } from '../../domain/dots';
import { DotsPlayerControls } from './DotsPlayerControls';

const game: DotsGameDefinition = {
  id: 'fictional-game', name: 'Fictional Dots', kind: 'dots', version: 1, mode: 'individual',
  groupNumber: 1, playerIds: ['a', 'b', 'c', 'd'], stakeMinor: null,
  specials: [{ kind: 'hogan', units: 1 }, { kind: 'seve', units: 1 }, { kind: 'sandy', units: 1 }, { kind: 'birdie', units: 2 }],
};
function Editor() {
  const [declaration, setDeclaration] = useState<DotsPlayerDeclaration>({ playerId: 'a', counts: {}, calls: [] });
  return <DotsPlayerControls game={game} declaration={declaration} saved={undefined}
    name="Fictional golfer" par={4} onChange={setDeclaration} />;
}

describe('quick per-golfer Dots choices', () => {
  it('keeps common choices and the Sandy counter visible while optional count editing stays collapsed', async () => {
    const user = userEvent.setup();
    render(<Editor />);
    const hogan = screen.getByRole('checkbox', { name: 'Hogan for Fictional golfer' });
    expect(hogan).toBeVisible();
    expect(screen.getByLabelText('Hogan count · Fictional golfer')).not.toBeVisible();
    expect(screen.queryByRole('checkbox', { name: /Birdie/ })).not.toBeInTheDocument();
    await user.click(hogan);
    expect(hogan).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Seve for Fictional golfer' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Increase Sandy for Fictional golfer' }));
    expect(screen.getByLabelText('Sandy count · Fictional golfer')).toHaveValue(1);
    await user.click(screen.getByText('Details / edit counts', { selector: 'summary' }));
    const count = screen.getByLabelText('Hogan count · Fictional golfer');
    expect(count).toBeVisible();
    await user.clear(count);
    await user.type(count, '2');
    expect(count).toHaveValue(2);
    expect(hogan).toBeChecked();
    await user.click(screen.getByText('Details / edit counts', { selector: 'summary' }));
    expect(count).not.toBeVisible();
    expect(screen.getByLabelText('Sandy count · Fictional golfer')).toHaveValue(1);
  });
});
