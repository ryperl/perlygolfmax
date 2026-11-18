import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { DotsGameDefinition, DotsResults as Results } from '../../domain/dots';
import { calculateDotSettlement } from '../../domain/dot-settlement';
import { DotsResults } from './DotsResults';
import { InternalSettlement } from './InternalSettlement';
import { dotsFixture } from './dots.test-support';

describe('saved Dots awards and one internal settlement', () => {
  it('labels rotating specials without claiming a base match and distinguishes missing order from server-marked late recovery', () => {
    const f = dotsFixture();
    const game: DotsGameDefinition = { ...f.game, version: 2, mode: 'rotating', rotationHoles: 3 };
    const result: Results = { status: 'in-progress', holes: [], players: [], issues: [], unawarded: [], awards: [] };
    const view = render(<DotsResults game={game} result={result} />);
    expect(screen.getByText('Partner order pending. No sharing is inferred.')).toBeVisible();
    expect(screen.getByText(/Modified Sixes · 3-hole partners/)).toBeVisible();
    view.rerender(<DotsResults game={game} result={{ ...result, rotation: {
      firstHole: 8, rotation: { playerIds: f.ids, recordedLate: true }, contexts: [],
    } }} />);
    expect(screen.getByText('Cycle starts on hole 8 · Order recovered after scoring started')).toBeVisible();
    expect(screen.queryByText(/Partner order pending/)).not.toBeInTheDocument();
  });

  it('explains round bonus units, recipients and source facts without showing identities or claiming historical audit', () => {
    const { game, f, ids } = dotsFixture();
    const id = ids[0] ?? '';
    const result: Results = { status: 'complete', holes: [], players: [], issues: [], unawarded: [],
      awards: [{ id: 'private-award-id', number: null, kind: 'king-of-the-hill', source: 'derived', earnedBy: id,
        recipientIds: [id], units: 1, count: 1, multiplier: 1, dots: 1, sourceHoles: [1, 3],
        scores: [{ playerId: id, number: 1, strokes: 3, par: 3 }], reason: 'king-kp' }] };
    const players = f.cards.map((card) => ({ playerId: card.playerId, displayName: card.displayName, holes: [],
      playingHandicap: null, holesScored: 9, totalHoles: 9, status: 'complete' as const, frontPoints: 0, backPoints: 0, totalPoints: 1 }));
    const view = render(<DotsResults game={game} result={{ ...result, players }} />);
    screen.getByText('Saved award explanations and score evidence').click();
    expect(view.container).toHaveTextContent('Round bonus · King of the Hill');
    expect(view.container).toHaveTextContent('1 units × 1 × 1 = 1 dots each');
    expect(view.container).toHaveTextContent('Source holes 1, 3');
    expect(view.container).toHaveTextContent('Hole 1 · 3 / par 3');
    expect(view.container).not.toHaveTextContent('private-award-id');
    expect(view.container).not.toHaveTextContent(id);
    expect(view.container).toHaveTextContent('not a historical audit view');
  });

  it('shows exact net due/owed once, provisional status, source dot totals and points-only/unavailable states', () => {
    const { f, game } = dotsFixture();
    const settlement = calculateDotSettlement({ groupNumber: 1, gameIds: [game.id], stakeMinor: 100, complete: false,
      players: f.cards.map((card, index) => ({ playerId: card.playerId, displayName: card.displayName,
        baseDots: index < 2 ? 5 : 0, specialDots: 1 })) });
    const view = render(<InternalSettlement settlement={settlement} />);
    expect(screen.getByText('Provisional settlement · Not paid')).toBeVisible();
    expect(screen.getAllByRole('cell', { name: /Due USD\s+10.00/ })).toHaveLength(2);
    expect(screen.getAllByRole('cell', { name: /Owes USD\s+10.00/ })).toHaveLength(2);
    expect(screen.getByText(/Total to settle: USD\s+20.00/)).toBeVisible();
    expect(screen.getByRole('columnheader', { name: 'Base dots' })).toBeVisible();
    expect(screen.getByRole('columnheader', { name: 'Special dots' })).toBeVisible();
    view.rerender(<InternalSettlement settlement={{ ...settlement, status: 'points-only', stakeMinor: null }} />);
    expect(screen.getByText('No money configured · Points-only')).toBeVisible();
    expect(screen.queryByText(/Total to settle:/)).not.toBeInTheDocument();
    view.rerender(<InternalSettlement settlement={{ ...settlement, status: 'unavailable', totalToSettleMinor: null,
      players: settlement.players.map((player) => ({ ...player, netMinor: null })) }} />);
    expect(screen.getByText('Settlement unavailable')).toBeVisible();
    expect(screen.getAllByRole('cell', { name: 'Unavailable' })).toHaveLength(4);
  });

  it('names both explicitly linked sources while retaining one combined settlement', () => {
    const { f, game } = dotsFixture();
    const settlement = calculateDotSettlement({ groupNumber: 1, gameIds: [game.id, '00000000-0000-4000-8000-000000000981'],
      stakeMinor: 50, complete: false, players: f.cards.map((card) => ({
        playerId: card.playerId, displayName: card.displayName, baseDots: 1, specialDots: 2,
      })) });
    render(<InternalSettlement settlement={settlement} gameNames={['Fictional Wolf', 'Fictional specials']} />);
    expect(screen.getByRole('region', { name: 'Group 1 Fictional Wolf + Fictional specials internal settlement' })).toBeVisible();
    expect(screen.getByText('One combined settlement for these explicitly linked games.')).toBeVisible();
    expect(screen.getAllByText(/Total to settle:/)).toHaveLength(1);
  });
});
