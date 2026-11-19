import { fireEvent, render, screen } from '@testing-library/react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { churchyV3Fixture } from '../../domain/churchy-v3.test-support';
import type { ChurchySpecialsV3 } from '../../domain/churchy';
import { ChurcieEntryControls } from './ChurcieEntryControls';

beforeAll(() => {
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: { configurable: true, value(this: HTMLDialogElement) { this.setAttribute('open', ''); } },
    close: { configurable: true, value(this: HTMLDialogElement) { this.removeAttribute('open'); } },
  });
});
afterAll(() => {
  Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal');
  Reflect.deleteProperty(HTMLDialogElement.prototype, 'close');
});

describe('Churchie default named category controls', () => {
  it('uses entered gross rather than stale saved scores, keeps invalid input pending, and gates new Murphy controls on API capability', () => {
    const f = churchyV3Fixture(9, 1, 'tee');
    const round = { ...f.round(), churchyMurphyTargets: true as const };
    const saved: ChurchySpecialsV3 = { version: 3, gameId: f.game.id,
      gameEtag: round.games?.configuration.etag ?? '', number: 1, contests: [],
      players: [{ playerId: f.ids[0] ?? '', counts: {}, calls: [{
        id: 'fictional-call', kind: 'murphy', result: 'pending', murphyTarget: 'par',
      }] }] };
    const onChange = vi.fn();
    const props = { round, game: f.game, saved, draft: undefined, disabled: false,
      playerId: f.ids[0], holeNumber: 1, onChange };
    const view = render(<ChurcieEntryControls {...props} playerScore={{ kind: 'strokes', strokes: 5 }} />);
    fireEvent.click(screen.getByRole('button', { name: /Dots for .*Churchie/ }));
    expect(screen.getByText('Missed · opponents earn · needs 4 or better')).toBeVisible();
    view.rerender(<ChurcieEntryControls {...props} playerScore={null} />);
    expect(screen.getByText('Pending · enter a gross score')).toBeVisible();
    view.rerender(<ChurcieEntryControls {...props} playerScore={{ kind: 'strokes', strokes: 3 }} />);
    expect(screen.getByText('Made · needs 4 or better')).toBeVisible();
    expect(onChange).not.toHaveBeenCalled();
    view.rerender(<ChurcieEntryControls {...props} round={f.round()} saved={undefined} />);
    expect(screen.queryByRole('checkbox', { name: /Murphy called/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Call Murphy/ })).toBeVisible();
  });

  it('offers one group-level Blue Plate selector on par 5s and KP on par 3s without inferring an award', () => {
    const f = churchyV3Fixture(9, 1, 'tee');
    const round = { ...f.round(), layout: f.snapshot.teeProfile.holes.map((hole) => ({
      ...hole, par: hole.number === 2 ? 5 : hole.number === 3 ? 3 : 4,
    })) };
    const onChange = vi.fn<(record: ChurchySpecialsV3) => void>();
    const props = { round, game: f.game, saved: undefined, draft: undefined, disabled: false, onChange };
    const view = render(<ChurcieEntryControls {...props} holeNumber={1} />);
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    view.rerender(<ChurcieEntryControls {...props} holeNumber={2} />);
    expect(screen.getAllByRole('combobox', { name: 'Blue Plate result' })).toHaveLength(1);
    expect(screen.queryByRole('combobox', { name: 'KP result' })).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole('combobox', { name: 'Blue Plate result' }), { target: { value: f.ids[0] } });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ version: 3, number: 2,
      contests: [{ kind: 'blue-plate', status: 'awarded', winnerId: f.ids[0] }] }));
    view.rerender(<ChurcieEntryControls {...props} holeNumber={3} />);
    expect(screen.getAllByRole('combobox', { name: 'KP result' })).toHaveLength(1);
    expect(screen.queryByRole('combobox', { name: 'Blue Plate result' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox', { name: 'KP result' }), { target: { value: 'none' } });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ version: 3, number: 3,
      contests: [{ kind: 'kp', status: 'no-qualifier' }] }));
  });

  it('does not silently enable categories in an existing saved definition', () => {
    const f = churchyV3Fixture(9, 1, 'tee');
    const game = { ...f.game, specials: f.game.specials.filter((special) => special.kind !== 'kp' && special.kind !== 'blue-plate') };
    const round = { ...f.round(), layout: f.snapshot.teeProfile.holes.map((hole) => ({ ...hole, par: 3 })) };
    const onChange = vi.fn();
    const props = { round, game, saved: undefined, draft: undefined, disabled: false, onChange };
    const view = render(<ChurcieEntryControls {...props} holeNumber={1} />);
    expect(screen.queryByRole('combobox', { name: 'KP result' })).not.toBeInTheDocument();
    view.rerender(<ChurcieEntryControls {...props} round={{ ...round, layout: round.layout.map((hole) => ({ ...hole, par: 5 })) }} holeNumber={1} />);
    expect(screen.queryByRole('combobox', { name: 'Blue Plate result' })).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });
});
