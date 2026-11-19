import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { DotsGameDefinition, DotsPlayerDeclaration } from '../../domain/dots';
import type { HoleScore } from '../../domain/scoring';
import { DotsPlayerControls } from './DotsPlayerControls';

const game: DotsGameDefinition = { id: 'fictional-game', name: 'Fictional specials', kind: 'dots', version: 1,
  mode: 'individual', groupNumber: 1, playerIds: ['a', 'b', 'c', 'd'], stakeMinor: null,
  specials: [{ kind: 'sandy', units: 1 }, { kind: 'pully', units: 1 }, { kind: 'murphy', units: 1 }] };

function Editor({ score, initial, changed }: {
  readonly score: HoleScore;
  readonly initial: DotsPlayerDeclaration;
  readonly changed: (value: DotsPlayerDeclaration) => void;
}) {
  const [declaration, setDeclaration] = useState(initial);
  return <DotsPlayerControls game={game} name="Fictional golfer" par={4} score={score}
    declaration={declaration} saved={initial} scoreDerivedMurphy allowMurphyPresses
    onChange={(value) => { setDeclaration(value); changed(value); }} />;
}

describe('Murphy target-aware special compatibility', () => {
  it('allows Sandy and Pully with a missed birdie Murphy followed by gross par and recomputes when the target changes', async () => {
    const user = userEvent.setup(), changed = vi.fn();
    render(<Editor score={{ kind: 'strokes', strokes: 4 }} changed={changed}
      initial={{ playerId: 'a', counts: {}, calls: [{ id: 'call', kind: 'murphy',
        result: 'pending', murphyTarget: 'birdie' }] }} />);
    expect(screen.getByText('Missed · opponents earn · needs 3 or better')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Increase Sandy for Fictional golfer' }));
    await user.click(screen.getByRole('checkbox', { name: 'Pully for Fictional golfer' }));
    expect(changed).toHaveBeenLastCalledWith(expect.objectContaining({ counts: { sandy: 1, pully: 1 } }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: 'Murphy for birdie · Fictional golfer' }));
    expect(screen.getByText('Made · needs 4 or better')).toBeVisible();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('does not use the birdie exception to authorize par-only claims after a bogey', () => {
    render(<Editor score={{ kind: 'strokes', strokes: 5 }} changed={vi.fn()}
      initial={{ playerId: 'a', counts: {}, calls: [{ id: 'call', kind: 'murphy',
        result: 'pending', murphyTarget: 'birdie' }] }} />);
    expect(screen.getByRole('button', { name: 'Increase Sandy for Fictional golfer' })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: 'Pully for Fictional golfer' })).toBeDisabled();
  });
});
