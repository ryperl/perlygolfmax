import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { DotsGameDefinition, DotsHoleRecord } from '../../domain/dots';
import { dotsSpecialCatalog } from '../../domain/dots';
import { DotsHoleControls } from './DotsHoleControls';
import { dotsFixture } from './dots.test-support';

describe('separate Dots hole declarations', () => {
  it('identifies fixed versus saved linked partners and solo context in each golfer entry', () => {
    const f = dotsFixture(), playerId = f.ids[0];
    if (!playerId) throw new Error('Missing fictional player');
    const fixed: DotsGameDefinition = { ...f.game, mode: 'fixed', partnerIds: f.ids };
    const props = { players: f.round.cards, playerId, holeNumber: 1, par: 4, etag: 'fictional',
      saved: undefined, draft: undefined, disabled: false, onChange: vi.fn() };
    const view = render(<DotsHoleControls {...props} game={fixed} />);
    expect(screen.getByText('Fixed partner: Fictional golfer 2 · All round')).toBeVisible();
    const linked: DotsGameDefinition = { id: f.game.id, name: f.game.name, kind: 'dots', version: 1, mode: 'linked',
      linkedGameId: 'fictional-wolf', groupNumber: 1, playerIds: f.ids, specials: f.game.specials };
    view.rerender(<DotsHoleControls {...props} game={linked} />);
    expect(screen.getByText('Partners pending saved Wolf choice')).toBeVisible();
    view.rerender(<DotsHoleControls {...props} game={linked} context={{ number: 1, status: 'ready',
      sides: [f.ids.slice(0, 1), f.ids.slice(1)], multiplier: 3 }} />);
    expect(screen.getByText('Solo · ×3')).toBeVisible();
  });

  it.each([['kp', 'KP', 3], ['blue-plate', 'Blue Plate', 5], ['long-drive', 'Long Drive', 5]] as const)(
    'offers optional second %s qualifiers only in partnered Assassin contexts and preserves the first winner on clear', (kind, label, par) => {
      const f = dotsFixture();
      const game: DotsGameDefinition = { ...f.game, mode: 'fixed', partnerIds: f.ids,
        specials: [{ kind, units: 1 }, { kind: 'assassin', units: 1 }] };
      const saved: DotsHoleRecord = { number: 1, gameId: game.id, gameEtag: 'fictional',
        players: [], contests: [{ kind, status: 'awarded', winnerId: f.ids[0] ?? '' }] };
      const onChange = vi.fn<(record: DotsHoleRecord) => void>();
      const props = { players: f.round.cards, holeNumber: 1, par, etag: 'fictional', saved,
        draft: undefined, groupOnly: true, disabled: false, onChange };
      const view = render(<DotsHoleControls {...props} game={game} />);
      const second = screen.getByLabelText(new RegExp(`${label} second-`));
      expect(second).toHaveValue('');
      expect(screen.getByRole('option', { name: 'Not relevant' })).toBeInTheDocument();
      fireEvent.change(second, { target: { value: f.ids[1] } });
      expect(onChange.mock.lastCall?.[0].contests).toEqual([{ kind, status: 'awarded', winnerId: f.ids[0], secondId: f.ids[1] }]);
      view.rerender(<DotsHoleControls {...props} game={game} draft={onChange.mock.lastCall?.[0]} />);
      fireEvent.change(screen.getByLabelText(new RegExp(`${label} second-`)), { target: { value: '' } });
      expect(onChange.mock.lastCall?.[0].contests).toEqual(saved.contests);
      view.rerender(<DotsHoleControls {...props} game={f.game} />);
      expect(screen.queryByLabelText(new RegExp(`${label} second-`))).not.toBeInTheDocument();
      const linked: DotsGameDefinition = { id: game.id, name: game.name, kind: 'dots', version: 1,
        mode: 'linked', linkedGameId: 'fictional-wolf', groupNumber: 1, playerIds: f.ids, specials: game.specials };
      view.rerender(<DotsHoleControls {...props} game={linked} context={{ number: 1, status: 'ready',
        sides: [f.ids.slice(0, 1), f.ids.slice(1)], multiplier: 2 }} />);
      expect(screen.queryByLabelText(new RegExp(`${label} second-`))).not.toBeInTheDocument();
    },
  );

  it.each(['individual', 'fixed'] as const)('omits empty %s group chrome on ordinary holes, including zero-only drafts', (mode) => {
    const f = dotsFixture();
    const game: DotsGameDefinition = mode === 'fixed' ? { ...f.game, mode, partnerIds: f.ids } : { ...f.game, mode };
    const onChange = vi.fn();
    const props = { game, players: f.round.cards, holeNumber: 1, par: 4, etag: 'fictional',
      saved: undefined, draft: undefined, groupOnly: true, disabled: false, onChange };
    const view = render(<DotsHoleControls {...props} />);
    expect(screen.queryByRole('group')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Clear/ })).not.toBeInTheDocument();
    view.rerender(<DotsHoleControls {...props} draft={{ number: 1, gameId: game.id, gameEtag: 'fictional',
      players: [{ playerId: f.ids[0] ?? '', counts: { sandy: 0 }, calls: [] }], contests: [] }} />);
    expect(screen.queryByRole('group')).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('keeps eligible contests visible but never stages a no-op Clear', () => {
    const f = dotsFixture(), onChange = vi.fn();
    render(<DotsHoleControls game={f.game} players={f.round.cards} holeNumber={1} par={3} etag="fictional"
      saved={undefined} draft={undefined} groupOnly disabled={false} onChange={onChange} />);
    expect(screen.getByLabelText('KP result')).toBeVisible();
    const clear = screen.getByRole('button', { name: `Clear ${f.game.name} hole specials` });
    expect(clear).toBeDisabled();
    fireEvent.click(clear);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('retains real selections on ordinary holes for explicit clearing and preserves rotation receipts on clear', () => {
    const f = dotsFixture(), onChange = vi.fn<(record: DotsHoleRecord) => void>();
    const saved: DotsHoleRecord = { number: 1, gameId: f.game.id, gameEtag: 'fictional',
      players: [{ playerId: f.ids[0] ?? '', counts: { sandy: 1 }, calls: [] }], contests: [] };
    const props = { players: f.round.cards, holeNumber: 1, par: 4, etag: 'fictional', draft: undefined,
      groupOnly: true, disabled: false, onChange };
    const view = render(<DotsHoleControls {...props} game={f.game} saved={saved} />);
    fireEvent.click(screen.getByRole('button', { name: `Clear ${f.game.name} hole specials` }));
    expect(onChange).toHaveBeenLastCalledWith({ ...saved, players: [], contests: [] });
    const game: DotsGameDefinition = { ...f.game, version: 2, mode: 'rotating', rotationHoles: 3 };
    const receipt = { ...saved, rotation: { playerIds: [...f.ids].reverse(), recordedLate: true as const } };
    view.rerender(<DotsHoleControls {...props} game={game} saved={receipt} />);
    fireEvent.click(screen.getByRole('button', { name: `Clear ${game.name} hole specials` }));
    expect(onChange.mock.lastCall?.[0].rotation).toEqual(receipt.rotation);
    view.rerender(<DotsHoleControls {...props} game={game} saved={{ ...receipt, players: [] }} />);
    expect(screen.getByRole('button', { name: `Clear ${game.name} hole specials` })).toBeDisabled();
  });

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

  it('offers keyboard-free Sandy counters and one-off toggles only for configured manual specials', () => {
    const f = dotsFixture();
    const game: DotsGameDefinition = { ...f.game, specials: [{ kind: 'sandy', units: 1 }, { kind: 'hogan', units: 1 }, { kind: 'birdie', units: 2 }] };
    const { Editor, onChange } = editor(game);
    render(<Editor />);
    const name = f.f.cards[0]?.displayName ?? '';
    fireEvent.click(screen.getByText(`${name} · Specials and calls`));
    fireEvent.click(screen.getByRole('button', { name: `Increase Sandy for ${name}` }));
    fireEvent.click(screen.getByRole('button', { name: `Increase Sandy for ${name}` }));
    expect(screen.getByLabelText(`Sandy count · ${name}`)).toHaveValue(2);
    fireEvent.click(screen.getByRole('button', { name: `Decrease Sandy for ${name}` }));
    fireEvent.click(screen.getByRole('checkbox', { name: `Hogan for ${name}` }));
    expect(onChange.mock.lastCall?.[0].players[0]?.counts).toMatchObject({ sandy: 1, hogan: 1 });
    expect(screen.queryByRole('checkbox', { name: /Birdie/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: /Seve/ })).not.toBeInTheDocument();
    expect(screen.getByLabelText(`Sandy count · ${name}`)).not.toHaveFocus();
  });

  it('blocks new impossible combinations per source golfer, not teammates, and leaves Walk as a warning', () => {
    const f = dotsFixture();
    const game: DotsGameDefinition = { ...f.game, mode: 'fixed', partnerIds: f.ids,
      specials: ['hogan', 'seve', 'murphy', 'chippy', 'pully', 'dime', 'super-dime', 'walk'].map((kind) => {
        const special = dotsSpecialCatalog.find((entry) => entry.kind === kind);
        if (!special) throw new Error('Missing fictional special.');
        return { kind: special.kind, units: 1 };
      }) };
    const { Editor, onChange } = editor(game);
    render(<Editor />);
    const first = f.f.cards[0]?.displayName ?? '', second = f.f.cards[1]?.displayName ?? '';
    for (const name of [first, second]) fireEvent.click(screen.getByText(`${name} · Specials and calls`));
    fireEvent.click(screen.getByRole('checkbox', { name: `Hogan for ${first}` }));
    expect(screen.getByRole('checkbox', { name: `Seve for ${first}` })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: `Chippy for ${first}` })).toBeDisabled();
    expect(screen.getByRole('button', { name: `Call Murphy · ${first}` })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: `Seve for ${second}` })).toBeEnabled();
    fireEvent.click(screen.getByRole('checkbox', { name: `Seve for ${second}` }));
    fireEvent.click(screen.getByRole('checkbox', { name: `Walk for ${first}` }));
    expect(screen.getByRole('note')).toHaveTextContent('This combination is allowed.');
    expect(onChange.mock.lastCall?.[0].players.find((player) => player.playerId === f.ids[0])?.counts).toMatchObject({ hogan: 1, walk: 1 });
    fireEvent.click(screen.getByRole('checkbox', { name: `Pully for ${first}` }));
    expect(screen.getByRole('checkbox', { name: `Dime for ${first}` })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: `SuperDime for ${first}` })).toBeDisabled();
  });

  it('requires an explicit clear before replacing an acknowledged Dime, staging both changes without a separate save', () => {
    const f = dotsFixture(), playerId = f.ids[0], name = f.f.cards[0]?.displayName ?? '';
    if (!playerId) throw new Error('Missing fictional player.');
    const saved: DotsHoleRecord = { number: 1, gameId: f.game.id, gameEtag: 'fictional',
      players: [{ playerId, counts: { dime: 1 }, calls: [] }], contests: [] };
    const onChange = vi.fn<(record: DotsHoleRecord) => void>();
    function Editor() {
      const [draft, setDraft] = useState<DotsHoleRecord>();
      return <DotsHoleControls game={f.game} players={f.round.cards} holeNumber={1} par={3} etag="fictional"
        saved={saved} draft={draft} playerId={playerId} disabled={false}
        onChange={(record) => { setDraft(record); onChange(record); }} />;
    }
    render(<Editor />);
    expect(screen.getByRole('checkbox', { name: `SuperDime for ${name}` })).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: `Dime for ${name}` }));
    expect(screen.getByRole('checkbox', { name: `SuperDime for ${name}` })).toBeEnabled();
    fireEvent.click(screen.getByRole('checkbox', { name: `SuperDime for ${name}` }));
    expect(onChange.mock.lastCall?.[0].players[0]?.counts).toEqual({ dime: 0, 'super-dime': 1 });
    expect(saved.players[0]?.counts.dime).toBe(1);
    expect(screen.queryByRole('button', { name: /Save/ })).not.toBeInTheDocument();
  });

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
