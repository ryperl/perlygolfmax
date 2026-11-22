import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DotsSettings } from './DotsSettings';
import type { DotsSetupDraft } from './DotsSettings';
import { buildGame, draftFromGame } from '../games/game-draft';
import { matchGamesFixture } from '../../domain/match-games.test-support';
import { gameScoringLabel } from '../games/game-presentation';
import { scorecardStrokeHandicap } from '../scoring/scorecard-presentation';
import type { DotsGameDefinition } from '../../domain/dots';

describe('Modified Sixes net contest setup', () => {
  it('offers explicit net High/Low and SO, keeps gross specials, and clears the contest on six-hole rotations', () => {
    const f = matchGamesFixture();
    function Editor() {
      const [draft, setDraft] = useState<DotsSetupDraft>({ dotsMode: 'rotating', dotsRotationHoles: 3,
        dotsPlayers: f.ids, groupNumber: 1, dotsSpecials: [] });
      return <DotsSettings draft={draft} groups={f.snapshot.groups} players={f.cards} wolves={[]}
        highLowSupported v2Supported onChange={(patch) => { setDraft({ ...draft, ...patch }); }} />;
    }
    render(<Editor />);
    expect(screen.getByRole('checkbox', { name: 'Net High/Low' })).not.toBeChecked();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Net High/Low' }));
    expect(screen.getByRole('combobox', { name: 'High/Low net strokes' })).toHaveValue('full-course-v1');
    fireEvent.change(screen.getByRole('combobox', { name: 'High/Low net strokes' }), { target: { value: 'group-low-v1' } });
    expect(screen.getByText(/Specials still use gross scores/)).toBeVisible();
    fireEvent.change(screen.getByRole('combobox', { name: 'Dots mode' }), { target: { value: 'rotating-6' } });
    expect(screen.queryByRole('checkbox', { name: 'Net High/Low' })).not.toBeInTheDocument();
    expect(screen.getByText('Specials only · No base match points.')).toBeVisible();
  });

  it('does not enable absent API support and preserves saved opt-in definitions through draft serialization', () => {
    const f = matchGamesFixture();
    const game: DotsGameDefinition = { id: f.wolf.id, name: 'Fictional Sixes', kind: 'dots', version: 2,
      mode: 'rotating', rotationHoles: 3, playerIds: f.ids, groupNumber: 1, specials: [], stakeMinor: null,
      highLow: { version: 1, handicapRule: 'group-low-v1' } };
    render(<DotsSettings draft={draftFromGame(game)} groups={f.snapshot.groups} players={f.cards} wolves={[]}
      v2Supported onChange={() => undefined} />);
    expect(screen.getByRole('checkbox', { name: 'Net High/Low' })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'High/Low net strokes' })).toBeDisabled();
    expect(buildGame(draftFromGame(game), f.ids)).toEqual(game);
    expect(gameScoringLabel(game)).toContain('Net High/Low + gross specials');
    expect(scorecardStrokeHandicap({ definition: game, result: undefined }, f.ids[0] ?? '',
      f.ids.map((playerId, index) => ({ playerId, courseHandicap: [11, 4, 8, 3][index] ?? 3 })), f.snapshot.groups))
      .toEqual({ basis: 'SO', value: 8 });
  });
});
