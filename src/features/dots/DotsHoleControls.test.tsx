import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { DotsGameDefinition, DotsHoleRecord } from '../../domain/dots';
import { DotsHoleControls } from './DotsHoleControls';
import { dotsFixture } from './dots.test-support';

describe('separate Dots hole declarations', () => {
  function editor(game?: DotsGameDefinition) {
    const fixture = dotsFixture();
    const selected = game ?? fixture.game;
    const onChange = vi.fn<(record: DotsHoleRecord) => void>();
    function Editor() {
      const [draft, setDraft] = useState<DotsHoleRecord>();
      return <DotsHoleControls game={selected} players={fixture.f.cards} holeNumber={1} par={3} etag="fictional-revision"
        saved={undefined} draft={draft} disabled={false} onChange={(record) => { setDraft(record); onChange(record); }} />;
    }
    return { ...fixture, onChange, Editor };
  }

  it('stages multiple bunkers and stable called outcomes without a second Save or automatic award toggles', () => {
    const { Editor, onChange, f, ids } = editor();
    render(<Editor />);
    const name = f.cards[0]?.displayName ?? '';
    fireEvent.click(screen.getByText(`${name} · Specials and calls`));
    fireEvent.change(screen.getByLabelText(`Sandy count · ${name}`), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: `Call Paree · ${name}` }));
    const called = onChange.mock.lastCall?.[0].players.find((player) => player.playerId === ids[0])?.calls[0];
    expect(called).toMatchObject({ kind: 'paree', result: 'pending' });
    expect(called?.id).toBeTruthy();
    fireEvent.change(screen.getByLabelText(`Paree call 1 · ${name}`), { target: { value: 'failure' } });
    const declaration = onChange.mock.lastCall?.[0].players.find((player) => player.playerId === ids[0]);
    expect(declaration).toMatchObject({ counts: { sandy: 2 }, calls: [{ ...called, result: 'failure' }] });
    expect(screen.queryByLabelText(/Birdie count/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Save/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/Thief/)).not.toBeInTheDocument();
  });

  it('replaces Dime with SuperDime, preserves other golfers and explicitly distinguishes pending contests from no qualifier', () => {
    const { Editor, onChange, f, ids } = editor();
    render(<Editor />);
    for (const card of f.cards.slice(0, 2)) fireEvent.click(screen.getByText(`${card.displayName} · Specials and calls`));
    fireEvent.change(screen.getByLabelText(`Sandy count · ${f.cards[1]?.displayName ?? ''}`), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText(`Dime count · ${f.cards[0]?.displayName ?? ''}`), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText(`SuperDime count · ${f.cards[0]?.displayName ?? ''}`), { target: { value: '1' } });
    expect(onChange.mock.lastCall?.[0].players.find((player) => player.playerId === ids[0])?.counts).toMatchObject({ dime: 0, 'super-dime': 1 });
    expect(onChange.mock.lastCall?.[0].players.find((player) => player.playerId === ids[1])?.counts.sandy).toBe(1);
    expect(screen.getByLabelText('KP result')).toHaveValue('');
    fireEvent.change(screen.getByLabelText('KP result'), { target: { value: 'none' } });
    expect(onChange.mock.lastCall?.[0].contests).toEqual([{ kind: 'kp', status: 'no-qualifier' }]);
  });

  it('captures both approaches for standalone Assassin, clears full hole records, and disables controls during save', () => {
    const f = dotsFixture();
    const game: DotsGameDefinition = { ...f.game, mode: 'fixed', partnerIds: f.ids, specials: [{ kind: 'assassin', units: 1 }] };
    const { Editor, onChange } = editor(game);
    const view = render(<Editor />);
    fireEvent.change(screen.getByLabelText('KP result'), { target: { value: f.ids[0] } });
    fireEvent.change(screen.getByLabelText(/KP second-closest/), { target: { value: f.ids[1] } });
    expect(onChange.mock.lastCall?.[0].contests).toEqual([{ kind: 'kp', status: 'awarded', winnerId: f.ids[0], secondId: f.ids[1] }]);
    fireEvent.click(screen.getByRole('button', { name: `Clear ${game.name} hole specials` }));
    expect(onChange.mock.lastCall?.[0]).toMatchObject({ players: [], contests: [] });
    view.rerender(<DotsHoleControls game={game} players={f.f.cards} holeNumber={1} par={3} etag="fictional"
      saved={undefined} draft={undefined} disabled onChange={onChange} />);
    expect(screen.getByLabelText('KP result')).toBeDisabled();
  });
});
