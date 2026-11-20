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
  it('identifies the custom named game in its scorer controls without changing the saved declaration identity', () => {
    const f = churchyV3Fixture(9, 1, 'tee');
    const onChange = vi.fn();
    const game = { ...f.game, name: 'Fictional evening challenge' };
    render(<ChurcieEntryControls round={f.round()} game={game} holeNumber={1} saved={undefined} draft={undefined}
      disabled={false} playerId={f.ids[0]} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /Dots for .*Fictional evening challenge/ }));
    fireEvent.click(screen.getByRole('button', { name: /Increase Sandy/ }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ gameId: game.id, version: 3 }));
  });

  it('shows only the current saved teams and follows the actual playing circuit across the turn', () => {
    const f = churchyV3Fixture(18, 10, 'tee'), round = f.round(), onChange = vi.fn();
    const [p1, p2, p3, p4] = f.ids.map((id) => round.cards.find((card) => card.playerId === id)?.displayName);
    if (!p1 || !p2 || !p3 || !p4) throw new Error('Missing fictional team names');
    const first = `${p1} + ${p4} vs ${p2} + ${p3}`;
    const second = `${p1} + ${p3} vs ${p2} + ${p4}`;
    const props = { round, game: f.game, saved: undefined, draft: undefined, disabled: false, orderOnly: true, onChange };
    const view = render(<ChurcieEntryControls {...props} holeNumber={10} />);
    const teams = screen.getByRole('group', { name: 'Current teams' });
    expect(teams).toHaveTextContent(first);
    expect(teams.closest('details')).toBeNull();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    view.rerender(<ChurcieEntryControls {...props} holeNumber={14} />);
    expect(teams).toHaveTextContent(second);
    view.rerender(<ChurcieEntryControls {...props} holeNumber={1} />);
    expect(teams).toHaveTextContent(first);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('keeps late saved approach order readonly and does not invent teams for a missing hole', () => {
    const f = churchyV3Fixture(18, 10);
    const record = { ...f.declaration(10, f.ids), rotation: { playerIds: f.ids, recordedLate: true as const } };
    const round = f.round(f.cards.map((card, index) => index ? card : { ...card,
      holes: card.holes.map((hole) => hole.number === 10 ? { ...hole, score: { kind: 'strokes', strokes: 4, churchy: record } } : hole) }));
    const onChange = vi.fn();
    const props = { round, game: f.game, saved: record, draft: undefined, disabled: false, orderOnly: true, onChange };
    const view = render(<ChurcieEntryControls {...props} holeNumber={14} />);
    expect(screen.getByRole('group', { name: 'Current teams' })).toHaveTextContent('Order recorded late');
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    view.rerender(<ChurcieEntryControls {...props} holeNumber={99} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Current teams are unavailable');
    expect(screen.queryByRole('group', { name: 'Current teams' })).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('keeps unsaved approach order input on the starting hole and pending teams explicit on later holes', () => {
    const f = churchyV3Fixture(18, 10), onChange = vi.fn();
    const round = f.round(f.cards.map((card, index) => index ? card : { ...card,
      holes: card.holes.map((hole) => hole.number === 10
        ? { ...hole, score: { kind: 'strokes', strokes: 4 } } : hole) }));
    const props = { round, game: f.game, saved: undefined, draft: undefined,
      disabled: false, orderOnly: true, onChange };
    const view = render(<ChurcieEntryControls {...props} holeNumber={10} />);
    expect(screen.getByLabelText('Closest approach')).toBeEnabled();
    view.rerender(<ChurcieEntryControls {...props} holeNumber={14} />);
    expect(screen.getByText(/Teams pending/)).toBeVisible();
    expect(screen.queryByRole('group', { name: 'Current teams' })).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('gates Paree score outcomes independently from Murphy and preserves manual Paree until explicit opt-in', () => {
    const f = churchyV3Fixture(9, 1, 'tee');
    const round = { ...f.round(), churchyPareeTargets: true as const };
    const saved: ChurchySpecialsV3 = { version: 3, gameId: f.game.id,
      gameEtag: round.games?.configuration.etag ?? '', number: 1, contests: [],
      players: [{ playerId: f.ids[0] ?? '', counts: {}, calls: [{
        id: 'legacy-paree', kind: 'paree', result: 'failure',
      }] }] };
    const onChange = vi.fn();
    const props = { round, game: f.game, saved, draft: undefined, disabled: false,
      playerId: f.ids[0], holeNumber: 1, onChange };
    const view = render(<ChurcieEntryControls {...props} playerScore={{ kind: 'strokes', strokes: 4 }} />);
    fireEvent.click(screen.getByRole('button', { name: /Dots for .*Churchie/ }));
    expect(screen.getByRole('checkbox', { name: /Paree called/ })).toBeChecked();
    expect(screen.getByText('Manual result: Missed')).toBeVisible();
    expect(screen.getByRole('button', { name: /Call Murphy/ })).toBeVisible();
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Use score outcome' }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ players: [{
      playerId: f.ids[0], counts: {}, calls: [{ id: 'legacy-paree', kind: 'paree', result: 'pending', pareeTarget: 'par' }],
    }] }));
    view.rerender(<ChurcieEntryControls {...props} round={f.round()} saved={undefined} />);
    expect(screen.queryByRole('checkbox', { name: /Paree called/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Call Paree/ })).toBeVisible();
  });

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
