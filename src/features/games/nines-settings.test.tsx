import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { RoundGameDefinition } from '../../domain/games';
import { roundGameKinds } from '../../domain/games';
import { calculateGameResults } from '../../domain/stableford';
import { calculateNinesSettlement } from '../../domain/nines';
import type { NinesGameDefinition } from '../../domain/nines';
import { strokeGameFixture, strokeGameId } from '../../domain/stroke-games.test-support';
import { GameSettings } from './GameSettings';
import { GameResults } from './GameResults';
import { InternalSettlement } from '../dots/InternalSettlement';
import { buildGame, draftFromGame, newGameDraft, ninesDraftProblem, setGameKind, defaultGameGroup } from './game-draft';
import { gameScoringLabel } from './game-presentation';

/** A round with one saved group of three golfers, plus optionally a foursome. */
function fixture(groupSizes: readonly number[] = [3]) {
  const total = groupSizes.reduce((sum, size) => sum + size, 0);
  const f = strokeGameFixture(18, total);
  const ids = f.snapshot.players.map((player) => player.playerId);
  let next = 0;
  const groups = groupSizes.map((size, index) => {
    const playerIds = ids.slice(next, next + size);
    next += size;
    return { number: index + 1, playerIds };
  });
  return { ...f, ids, groups, snapshot: { ...f.snapshot, groups } };
}

function Harness({ groups, roster, save }: {
  readonly groups: ReturnType<typeof fixture>['groups'];
  readonly roster: ReturnType<typeof fixture>['cards'];
  readonly save: (game: RoundGameDefinition | null) => void;
}) {
  const [draft, change] = useState(() => newGameDraft(true));
  return <GameSettings draft={draft} roster={roster} groups={groups} supportedGameKinds={roundGameKinds}
    gameHandicapsSupported holeNumbers={[]} disabled={false} saveDisabled={false} cancelDisabled={false} retry={false}
    onChange={change} onSave={() => { save(buildGame(draft, roster.map((card) => card.playerId))); }} onCancel={vi.fn()} />;
}

describe('Nines game setup', () => {
  it('picks the saved group of three, plays net strokes off the low golfer, and saves an optional stake per point', async () => {
    const user = userEvent.setup();
    const f = fixture([4, 3]);
    const save = vi.fn();
    render(<Harness groups={f.groups} roster={f.cards} save={save} />);
    await user.selectOptions(screen.getByLabelText('Game type'), 'nines');
    const setup = screen.getByRole('region', { name: 'Nines setup' });
    // Only the group of three is offered; the foursome cannot play Nines.
    expect(within(setup).getAllByRole('option').map((option) => option.textContent)).toEqual(['Choose a saved group of three', 'Group 2']);
    expect(within(setup).getByLabelText('Playing group of three')).toHaveValue('2');
    await user.selectOptions(screen.getByLabelText('Score basis'), 'net');
    await user.selectOptions(screen.getByLabelText('Net handicap rule'), 'group-low-v1');
    await user.type(within(setup).getByLabelText('Stake per point (USD)'), '.25');
    await user.click(screen.getByRole('button', { name: 'Save game' }));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ kind: 'nines', version: 1, name: 'Nines', basis: 'net',
      handicapRule: 'group-low-v1', groupNumber: 2, playerIds: f.groups[1]?.playerIds, stakeMinor: 25 }));
  });

  it('gross saves no handicap rule, and a blank stake plays for points only', () => {
    const f = fixture();
    const draft = defaultGameGroup(setGameKind(newGameDraft(true), 'nines', f.cards.length), f.groups);
    const game = buildGame(draft, f.ids);
    expect(game).toEqual(expect.objectContaining({ kind: 'nines', basis: 'gross', stakeMinor: null }));
    expect(game && 'handicapRule' in game).toBe(false);
  });

  it('explains what to fix when there is no group of three or the stake is not money', () => {
    const f = fixture([4]);
    const draft = setGameKind(newGameDraft(true), 'nines', f.cards.length);
    expect(ninesDraftProblem(draft, f.ids, f.groups)).toMatch(/exactly three golfers/);
    const three = fixture();
    const chosen = defaultGameGroup(setGameKind(newGameDraft(true), 'nines', three.cards.length), three.groups);
    expect(ninesDraftProblem({ ...chosen, stake: 'lots' }, three.ids, three.groups)).toMatch(/dollars and cents/);
    expect(buildGame({ ...chosen, stake: 'lots' }, three.ids)).toBeNull();
    expect(ninesDraftProblem(chosen, three.ids, three.groups)).toBeNull();
  });

  it('reopens a saved game with its group, basis and stake intact', () => {
    const f = fixture();
    const saved: NinesGameDefinition = { id: strokeGameId(1500), name: 'Our Nines', kind: 'nines', version: 1,
      basis: 'net', handicapRule: 'full-course-v1', groupNumber: 1, playerIds: f.ids, stakeMinor: 50 };
    expect(buildGame(draftFromGame(saved), f.ids)).toEqual(saved);
    expect(gameScoringLabel(saved)).toBe('Group 1 · Nines 5-3-1 · Net · 100% Course Handicap');
  });
});

describe('Nines results and money', () => {
  it('shows points per hole with the Nines explanation', () => {
    const f = fixture();
    const game: NinesGameDefinition = { id: strokeGameId(1500), name: 'Nines', kind: 'nines', version: 1,
      basis: 'gross', groupNumber: 1, playerIds: f.ids, stakeMinor: null };
    const [result] = calculateGameResults([game], f.snapshot, f.cards);
    render(<GameResults game={game} result={result} holeNumbers={f.snapshot.teeProfile.holes.map((hole) => hole.number)} />);
    expect(screen.getByText(/5 \/ 3 \/ 1 points per hole/)).toBeVisible();
    // Every golfer shot 4 on every hole: three-way ties, 3 points each, 27 on the front nine.
    const table = screen.getByRole('table');
    expect(within(table).getAllByRole('row')).toHaveLength(4);
    expect(within(table).getAllByText('27')).not.toHaveLength(0);
  });

  it('describes the settlement in points, not dots', () => {
    const f = fixture();
    const game: NinesGameDefinition = { id: strokeGameId(1500), name: 'Nines', kind: 'nines', version: 1,
      basis: 'gross', groupNumber: 1, playerIds: f.ids, stakeMinor: 100 };
    const [result] = calculateGameResults([game], f.snapshot, f.cards);
    const settlement = calculateNinesSettlement(game, result, (id) => f.cards.find((card) => card.playerId === id)?.displayName ?? '');
    render(<InternalSettlement settlement={settlement} gameNames={['Nines']} unit="points" />);
    expect(screen.getAllByText('54 points')).toHaveLength(3);
    expect(screen.queryByText(/dots/)).not.toBeInTheDocument();
    expect(screen.getByText(/per point difference/)).toBeInTheDocument();
  });
});
