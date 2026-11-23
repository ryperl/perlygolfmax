import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DotsSettings } from './DotsSettings';
import type { DotsSetupDraft } from './DotsSettings';
import { DotsRotationControls } from './DotsRotationControls';
import { DotsHighLowPreview } from './DotsHighLowPreview';
import { buildGame, draftFromGame, newGameDraft, setGameKind } from '../games/game-draft';
import { matchGamesFixture } from '../../domain/match-games.test-support';
import { dotsRotationContext } from '../../domain/dots';
import type { DotsGameDefinition, DotsHoleRecord } from '../../domain/dots';

describe('updated rotating Dots setup and first teams', () => {
  it('previews actual off-low net comparisons and never awards a sweep on a pushed High lane', () => {
    const f = matchGamesFixture();
    const game: DotsGameDefinition = { id: f.wolf.id, name: 'Fictional net preview', kind: 'dots', version: 3,
      mode: 'rotating', rotationHoles: 3, orderMode: 'tee-flip', groupNumber: 1, playerIds: f.ids,
      specials: [], stakeMinor: null, highLow: { version: 2, handicapRule: 'group-low-v1' } };
    const number = 12;
    const round = { ...f.round(), teeStrokeAllocation: true, layout: f.snapshot.teeProfile.holes.map((hole) => ({
      ...hole, allocation: hole.number,
    })), courseHandicaps: f.ids.map((playerId, index) => ({ playerId, courseHandicap: [0, 4, 12, 3][index] ?? 0 })) };
    const record: DotsHoleRecord = { number, gameId: game.id, gameEtag: 'fictional', players: [], contests: [],
      rotation: { playerIds: f.ids } };
    const scores = f.ids.map((playerId, index) => ({ playerId, score: { kind: 'strokes' as const, strokes: [5, 4, 6, 5][index] ?? 5 } }));
    const view = render(<DotsHighLowPreview round={round} game={game} number={number} record={record} playerScores={scores} />);
    expect(screen.getByText('Preview High/Low')).toBeVisible();
    expect(screen.getByText('High 5 vs 5 · Push')).toBeVisible();
    expect(screen.getByText(/Low 4 vs 5/)).toHaveTextContent('Fictional golfer 1 + Fictional golfer 2 +1 each');
    expect(screen.getByText('Automatic High/Low Sweep · None')).toBeVisible();
    view.rerender(<DotsHighLowPreview round={round} game={game} number={number} record={record}
      playerScores={[{ playerId: f.ids[0] ?? '', score: undefined }]} />);
    expect(screen.getByText(/preview unavailable · Check the entered scores/)).toBeVisible();
  });
  it.each([3, 6] as const)('offers both first-team methods and the same net rules for %s-hole blocks', (length) => {
    const f = matchGamesFixture();
    function Editor() {
      const [draft, setDraft] = useState<DotsSetupDraft>({ dotsMode: 'individual', groupNumber: 1,
        dotsPlayerIds: f.ids, dotsPlayers: f.ids, dotsSpecials: [] });
      return <DotsSettings draft={draft} groups={f.snapshot.groups} players={f.cards} wolves={[]}
        v2Supported v3Supported highLowSupported manualSweepSupported existing={false}
        onChange={(patch) => { setDraft({ ...draft, ...patch }); }} />;
    }
    render(<Editor />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Dots mode' }), { target: { value: `rotating-${String(length)}` } });
    expect(screen.getByRole('combobox', { name: 'Choose first teams by' })).toHaveValue('tee-flip');
    fireEvent.change(screen.getByRole('combobox', { name: 'Choose first teams by' }), { target: { value: 'approach' } });
    expect(screen.getByText(/Closest \+ farthest play the middle two/)).toBeVisible();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Net High/Low' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'High/Low net strokes' }), { target: { value: 'group-low-v1' } });
    expect(screen.getByText(/High 1 \+ Low 1 \+ Sweep 1 = 3 each/)).toBeVisible();
    expect(screen.getByRole('region', { name: 'Review Dots setup' })).toHaveTextContent('Off lowest golfer');
    expect(screen.getByRole('region', { name: 'Review Dots setup' })).toHaveTextContent(`every ${String(length)} played holes`);
    expect(screen.queryByRole('combobox', { name: 'Closest approach' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox', { name: 'Dots mode' }), { target: { value: 'individual' } });
    expect(screen.queryByRole('combobox', { name: 'Choose first teams by' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox', { name: 'Dots mode' }), { target: { value: 'rotating-3' } });
    expect(screen.getByRole('combobox', { name: 'Choose first teams by' })).toHaveValue('approach');
    expect(screen.getByRole('checkbox', { name: 'Net High/Low' })).not.toBeChecked();
  });

  it('preserves legacy rules until explicit unstarted upgrade and retains the version3 draft on missing support', () => {
    const f = matchGamesFixture();
    const legacy: DotsGameDefinition = { id: f.wolf.id, name: 'Fictional legacy Dots', kind: 'dots', version: 2,
      mode: 'rotating', rotationHoles: 3, groupNumber: 1, playerIds: f.ids, specials: [], stakeMinor: null,
      highLow: { version: 1, handicapRule: 'group-low-v1' } };
    const change = vi.fn();
    const props = { groups: f.snapshot.groups, players: f.cards, wolves: [], onChange: change, v2Supported: true, highLowSupported: true };
    const view = render(<DotsSettings {...props} draft={draftFromGame(legacy)} v3Supported />);
    expect(change).not.toHaveBeenCalled();
    expect(screen.queryByRole('combobox', { name: 'Choose first teams by' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Use updated team and scoring rules' }));
    expect(change).toHaveBeenLastCalledWith({ dotsVersion: 3, dotsOrderMode: 'tee-flip' });
    const draft = { ...draftFromGame(legacy), dotsVersion: 3 as const, dotsOrderMode: 'approach' as const };
    const game = buildGame(draft, f.ids);
    expect(game).toMatchObject({ version: 3, orderMode: 'approach', highLow: { version: 2, handicapRule: 'group-low-v1' } });
    if (!game) throw new Error('Missing fictional updated game');
    expect(buildGame(draftFromGame(game), f.ids)).toEqual(game);
    view.rerender(<DotsSettings {...props} draft={draft} v3Supported={false} />);
    expect(screen.getByRole('combobox', { name: 'Choose first teams by' })).toHaveValue('approach');
    expect(screen.getByRole('combobox', { name: 'Choose first teams by' })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: 'Net High/Low' })).toBeDisabled();
    expect(setGameKind(setGameKind({ ...newGameDraft(), ...draft }, 'wolf', 4), 'dots', 4).dotsVersion).toBeUndefined();
  });

  it.each(['tee-flip', 'approach'] as const)('chooses %s on the first hole and shows only saved teams afterward', (orderMode) => {
    const f = matchGamesFixture();
    const game: Extract<DotsGameDefinition, { readonly version: 3 }> = { id: f.wolf.id, name: 'Fictional first teams', kind: 'dots', version: 3,
      mode: 'rotating', rotationHoles: 6, orderMode, groupNumber: 1, playerIds: f.ids, specials: [], stakeMinor: null };
    function Order({ locked = false }: { readonly locked?: boolean }) {
      const [record, setRecord] = useState<DotsHoleRecord>({ number: 10, gameId: game.id, gameEtag: 'fictional-revision',
        players: [], contests: [], ...(locked ? { rotation: { playerIds: f.ids } } : {}) });
      const round = { layout: f.snapshot.teeProfile.holes, groups: [{ number: 1, playerIds: f.ids, startingHole: 10 }], cards: [] };
      const rotation = dotsRotationContext(game, round, [record]);
      return <DotsRotationControls game={game} record={record} holeNumber={10} rotation={rotation} players={f.cards}
        locked={locked} onChange={setRecord} />;
    }
    const view = render(<Order />);
    const labels = orderMode === 'approach'
      ? ['Closest approach', 'Next closest approach', 'Next farthest approach', 'Farthest approach']
      : ['First in tee flip', 'Second in tee flip', 'Third in tee flip', 'Fourth in tee flip'];
    for (const [index, label] of labels.entries()) {
      fireEvent.change(screen.getByRole('combobox', { name: label }), { target: { value: f.ids[index] } });
    }
    expect(screen.getByText(/Partner preview/)).toHaveTextContent(orderMode === 'approach'
      ? 'Fictional golfer 1 + Fictional golfer 4 vs Fictional golfer 2 + Fictional golfer 3'
      : 'Fictional golfer 1 + Fictional golfer 2 vs Fictional golfer 3 + Fictional golfer 4');
    view.rerender(<Order locked />);
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.getByText(/Saved teams/)).toBeVisible();
  });
});
