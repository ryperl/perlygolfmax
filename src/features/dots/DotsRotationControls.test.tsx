import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { dotsRotationContext } from '../../domain/dots';
import type { DotsGameDefinition, DotsHoleRecord } from '../../domain/dots';
import { DotsRotationControls } from './DotsRotationControls';
import { dotsFixture } from './dots.test-support';

describe('first-played Dots partner order', () => {
  it('requires explicit P1–P4, stages partial choices, and previews the actual circuit without choosing defaults', () => {
    const f = dotsFixture();
    const game: Extract<DotsGameDefinition, { readonly version: 2 }> = { ...f.game, version: 2, mode: 'rotating', rotationHoles: 3 };
    const round = { ...f.round, groups: f.round.groups.map((group) => ({ ...group, startingHole: 8 })),
      cards: f.round.cards.map((card) => ({ ...card, holes: card.holes.map((hole) => ({ ...hole, score: { kind: 'unplayed' as const } })) })) };
    const onChange = vi.fn<(record: DotsHoleRecord) => void>();
    function Editor() {
      const [record, setRecord] = useState<DotsHoleRecord>({ number: 8, gameId: game.id, gameEtag: 'fictional', players: [], contests: [] });
      return <DotsRotationControls game={game} holeNumber={8} record={record} rotation={dotsRotationContext(game, round, [record])}
        locked={false} players={f.round.cards} onChange={(value) => { setRecord(value); onChange(value); }} />;
    }
    render(<Editor />);
    expect(screen.getByLabelText('Dots P1')).toHaveValue('');
    expect(screen.queryByText(/Partner preview/)).not.toBeInTheDocument();
    for (const [index, id] of f.ids.entries()) fireEvent.change(screen.getByLabelText(`Dots P${String(index + 1)}`), { target: { value: id } });
    expect(onChange).toHaveBeenCalledTimes(4);
    expect(onChange.mock.calls[0]?.[0].rotation?.playerIds).toEqual([f.ids[0], '', '', '']);
    expect(onChange.mock.lastCall?.[0]).toMatchObject({ number: 8, rotation: { playerIds: f.ids } });
    expect(screen.getByText(/Partner preview/)).toHaveTextContent(`${f.round.cards[0]?.displayName ?? ''} + ${f.round.cards[1]?.displayName ?? ''}`);
    fireEvent.click(screen.getByText('Preview partner cycle'));
    expect(screen.getAllByRole('listitem').map((item) => item.textContent.match(/Hole (\d+)/)?.[1]))
      .toEqual(['8', '9', '1', '2', '3', '4', '5', '6', '7']);
  });

  it('never offers an editable acknowledged order and keeps missing late recovery on the first actually played hole', () => {
    const f = dotsFixture();
    const game: Extract<DotsGameDefinition, { readonly version: 2 }> = { ...f.game, version: 2, mode: 'rotating', rotationHoles: 6 };
    const record: DotsHoleRecord = { number: 1, gameId: game.id, gameEtag: 'fictional', players: [], contests: [],
      rotation: { playerIds: [...f.ids].reverse(), recordedLate: true } };
    const onChange = vi.fn();
    const props = { game, record, players: f.round.cards, onChange };
    const view = render(<DotsRotationControls {...props} holeNumber={2} rotation={dotsRotationContext(game, f.round, [record])} locked />);
    expect(screen.queryByLabelText('Dots P1')).not.toBeInTheDocument();
    expect(screen.getByText(/marked late by the server/)).toBeVisible();
    const { rotation: omitted, ...missing } = record;
    void omitted;
    view.rerender(<DotsRotationControls {...props} record={missing} holeNumber={2}
      rotation={dotsRotationContext(game, f.round, [])} locked={false} />);
    expect(screen.getByText(/Return to first played hole 1/)).toBeVisible();
    expect(screen.queryByLabelText('Dots P1')).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });
});
