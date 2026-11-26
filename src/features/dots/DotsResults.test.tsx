import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { DotsGameDefinition, DotsResults as Results } from '../../domain/dots';
import { calculateDotSettlement } from '../../domain/dot-settlement';
import { DotsResults } from './DotsResults';
import { InternalSettlement } from './InternalSettlement';
import { dotsFixture } from './dots.test-support';

describe('saved Dots awards and one internal settlement', () => {
  it('explains saved game selections even when results are unavailable, without claiming new rules', () => {
    const f = dotsFixture();
    const game: DotsGameDefinition = { ...f.game, version: 2, mode: 'rotating', rotationHoles: 3,
      highLow: { version: 1, handicapRule: 'group-low-v1' },
      specials: [{ kind: 'long-drive', units: 1 }, { kind: 'blue-plate', units: 1 }] };
    render(<DotsResults game={game} result={undefined} />);
    expect(screen.getByText('How Dots works').closest('details')).not.toHaveAttribute('open');
    fireEvent.click(screen.getByText('How Dots works'));
    const help = screen.getByRole('region', { name: 'Dots game description' });
    expect(help).toHaveTextContent('Automatic Category Sweep:');
    expect(help).toHaveTextContent('This saved High/Low version has no automatic High/Low Sweep');
    expect(help).not.toHaveTextContent('High 1 + Low 1 + Sweep 1 = 3 each');
    expect(screen.getByText('Saved Dots results unavailable. Refresh to retry.')).toBeVisible();
  });

  it('describes a linked three-golfer game as Nines Dots, not as a teammate game', () => {
    const f = dotsFixture();
    // Linked Wolf needs four golfers, so three linked golfers can only be a Nines link.
    const game: DotsGameDefinition = { id: f.game.id, name: f.game.name, kind: 'dots', version: 1,
      groupNumber: 1, playerIds: f.game.playerIds.slice(0, 3), mode: 'linked', linkedGameId: 'fictional-nines',
      specials: [] };
    render(<DotsResults game={game} result={undefined} />);
    fireEvent.click(screen.getByText('How Dots works'));
    const help = screen.getByRole('region', { name: 'Dots game description' });
    expect(help).toHaveTextContent('Each golfer plays alone');
    expect(help).not.toHaveTextContent('credits each current teammate');
  });

  it('keeps transmitted High/Low, special and combined totals distinct and never calls pending base results complete', () => {
    const f = dotsFixture();
    const game: DotsGameDefinition = { ...f.game, version: 2, mode: 'rotating', rotationHoles: 3,
      highLow: { version: 1, handicapRule: 'group-low-v1' } };
    const player = { playerId: f.ids[0] ?? '', displayName: 'Fictional golfer 1', playingHandicap: 8, holes: [],
      holesScored: 1, totalHoles: 9, status: 'in-progress' as const, frontPoints: 3, backPoints: null, totalPoints: 3 };
    const result: Results = { status: 'complete', holes: [], players: [player], issues: [], unawarded: [], awards: [] };
    const highLow = { status: 'in-progress' as const, holes: [], awards: [], players: [{ ...player, totalPoints: 2 }] };
    render(<DotsResults game={game} result={result} highLow={highLow} players={[{ ...player, totalPoints: 5 }]} />);
    expect(screen.getByText('Provisional saved results')).toBeVisible();
    expect(screen.queryByText('Complete saved results')).not.toBeInTheDocument();
    const ledger = screen.getByRole('table', { name: 'Saved High/Low and special dots' });
    expect(within(ledger).getByRole('columnheader', { name: 'High/Low' })).toBeVisible();
    expect(within(ledger).getByRole('cell', { name: '2' })).toBeVisible();
    expect(within(ledger).getByRole('cell', { name: '3' })).toBeVisible();
    expect(within(ledger).getByRole('cell', { name: '5' })).toBeVisible();
    expect(screen.getByText('Net High/Low holes').closest('details')).not.toHaveAttribute('open');
  });
  it.each([2, 3])('explains a %i-player net using only actual participants', (count) => {
    const { f, game } = dotsFixture();
    const settlement = calculateDotSettlement({ groupNumber: 1, gameIds: [game.id], stakeMinor: 50, complete: true,
      players: f.cards.slice(0, count).map((card, index) => ({ playerId: card.playerId, displayName: card.displayName,
        baseDots: 0, specialDots: index === 0 ? 1 : 0 })) });
    const view = render(<InternalSettlement settlement={settlement} />);
    const rows = [...screen.getByRole('list', { name: 'Individual net settlement' }).children];
    expect(rows).toHaveLength(count);
    const first = rows[0];
    if (!(first instanceof HTMLElement)) throw new Error('Missing fictional settlement');
    fireEvent.click(first.querySelector('summary') ?? first);
    expect(first).toHaveTextContent(`(${String(count)} × 1 − 1)`);
    expect(first).toHaveTextContent(`One net amount across the ${String(count)} players.`);
    expect(first).not.toHaveTextContent('(4 ×');
    expect(view.container).not.toHaveTextContent('Fictional golfer 4');
  });

  it('shows solo earned dots without money, opponents or a settlement-method control', () => {
    const { f, game, ids } = dotsFixture(), player = f.cards[0];
    if (!player) throw new Error('Missing fictional golfer');
    const settlement = calculateDotSettlement({ groupNumber: 1, gameIds: [game.id], stakeMinor: null, complete: true,
      players: [{ playerId: player.playerId, displayName: player.displayName, baseDots: 0, specialDots: 3 }] });
    const view = render(<><DotsResults game={{ ...game, playerIds: ids.slice(0, 1), stakeMinor: null }} result={undefined} />
      <InternalSettlement settlement={settlement} /></>);
    expect(screen.getByText('Solo stats only', { exact: true })).toBeVisible();
    expect(screen.getByText('Solo stats only · No money')).toBeVisible();
    expect(screen.getByText('3 dots')).toBeVisible();
    expect(screen.queryByText('Rate and settlement method')).not.toBeInTheDocument();
    expect(view.container).not.toHaveTextContent(/Due USD|Owes USD/);
    expect(screen.getByRole('list', { name: 'Solo earned dots' }).children).toHaveLength(1);
  });

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

  it('retains server totals and fixed-partner identity without mounting award evidence or an audit panel', () => {
    const { game, f, ids } = dotsFixture();
    const id = ids[0] ?? '';
    const result: Results = { status: 'complete', holes: [], players: [], issues: [], unawarded: [],
      awards: [{ id: 'private-award-id', number: null, kind: 'king-of-the-hill', source: 'derived', earnedBy: id,
        recipientIds: [id], units: 1, count: 1, multiplier: 1, dots: 1, sourceHoles: [1, 3],
        scores: [{ playerId: id, number: 1, strokes: 3, par: 3 }], reason: 'king-kp' }] };
    const players = f.cards.map((card) => ({ playerId: card.playerId, displayName: card.displayName, holes: [],
      playingHandicap: null, holesScored: 9, totalHoles: 9, status: 'complete' as const, frontPoints: 0, backPoints: 0, totalPoints: 1 }));
    const fixed: DotsGameDefinition = { ...game, mode: 'fixed', partnerIds: ids };
    const view = render(<DotsResults game={fixed} result={{ ...result, players }} />);
    expect(screen.getByText('Fixed partners')).toBeVisible();
    expect(screen.getByText(/Fictional golfer 1 \+ Fictional golfer 2 vs Fictional golfer 3 \+ Fictional golfer 4/)).toBeVisible();
    expect(screen.getAllByRole('cell', { name: '1' })).toHaveLength(4);
    expect(screen.queryByText('Saved award explanations and score evidence')).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Individual round bonuses' })).toHaveTextContent('Fictional golfer 1 · King of the Hill +1');
    expect(view.container).not.toHaveTextContent('private-award-id');
    expect(view.container).not.toHaveTextContent(id);
  });

  it('shows exact net due/owed once, provisional status, source dot totals and points-only/unavailable states', () => {
    const { f, game } = dotsFixture();
    const settlement = calculateDotSettlement({ groupNumber: 1, gameIds: [game.id], stakeMinor: 100, complete: false,
      players: f.cards.map((card, index) => ({ playerId: card.playerId, displayName: card.displayName,
        baseDots: index < 2 ? 5 : 0, specialDots: 1 })) });
    const view = render(<InternalSettlement settlement={settlement} />);
    expect(screen.getByText('Provisional settlement · Not paid')).toBeVisible();
    const amounts = [...view.container.querySelectorAll('summary .internal-settlement-money')].map((element) => element.textContent);
    expect(amounts.filter((value) => /Due USD\s+10.00/.test(value))).toHaveLength(2);
    expect(amounts.filter((value) => /Owes USD\s+10.00/.test(value))).toHaveLength(2);
    expect(screen.getByText('Rate and settlement method').closest('details')).not.toHaveAttribute('open');
    fireEvent.click(screen.getByText('Rate and settlement method'));
    expect(screen.getByText(/Total to settle: USD\s+20.00/)).toBeVisible();
    expect(screen.getAllByText('Base 5 + Specials 1')).toHaveLength(2);
    const rows = [...screen.getByRole('list', { name: 'Individual net settlement' }).children];
    expect(rows).toHaveLength(4);
    expect(rows[0]?.querySelector('details')).not.toHaveAttribute('open');
    const first = rows[0];
    if (!(first instanceof HTMLElement)) throw new Error('Missing fictional settlement');
    fireEvent.click(first.querySelector('summary') ?? first);
    expect(within(first).getByText(/How calculated/)).toBeVisible();
    expect(first).toHaveTextContent('(4 × 6 − 14)');
    expect(first).toHaveTextContent('not additional payments');
    view.rerender(<InternalSettlement settlement={{ ...settlement, status: 'points-only', stakeMinor: null }} />);
    expect(screen.getByText('No money configured · Points-only')).toBeVisible();
    expect(screen.queryByText(/Total to settle:/)).not.toBeInTheDocument();
    view.rerender(<InternalSettlement settlement={{ ...settlement, status: 'unavailable', totalToSettleMinor: null,
      players: settlement.players.map((player) => ({ ...player, netMinor: null })) }} />);
    expect(screen.getByText('Settlement unavailable')).toBeVisible();
    expect(screen.getAllByText('Unavailable', { exact: true })).toHaveLength(4);
  });

  it('names both explicitly linked sources while retaining one combined settlement', () => {
    const { f, game } = dotsFixture();
    const settlement = calculateDotSettlement({ groupNumber: 1, gameIds: [game.id, '00000000-0000-4000-8000-000000000981'],
      stakeMinor: 50, complete: false, players: f.cards.map((card) => ({
        playerId: card.playerId, displayName: card.displayName, baseDots: 1, specialDots: 2,
      })) });
    render(<InternalSettlement settlement={settlement} gameNames={['Fictional Wolf', 'Fictional specials']} />);
    expect(screen.getByRole('region', { name: 'Group 1 Fictional Wolf + Fictional specials internal settlement' })).toBeVisible();
    fireEvent.click(screen.getByText('Rate and settlement method'));
    expect(screen.getByText('One combined settlement for these explicitly linked games.')).toBeVisible();
    expect(screen.getAllByText(/Total to settle:/)).toHaveLength(1);
  });

  it('ranks known combined totals with shared positions and keeps unavailable money out of ranked results', () => {
    const { f, game } = dotsFixture();
    const settlement = calculateDotSettlement({ groupNumber: 1, gameIds: [game.id], stakeMinor: 50, complete: true,
      players: f.cards.map((card, index) => ({ playerId: card.playerId, displayName: card.displayName,
        baseDots: 0, specialDots: [2, 5, 5, 1][index] ?? 0 })) });
    const view = render(<InternalSettlement settlement={settlement} ranked />);
    const rows = [...screen.getByRole('list', { name: 'Combined standings' }).children];
    expect(rows[0]).toHaveTextContent('Fictional golfer 2');
    expect(rows[1]).toHaveTextContent('Fictional golfer 3');
    expect(screen.getAllByLabelText('Tied position 1')).toHaveLength(2);
    expect(screen.getByLabelText('Position 3')).toBeVisible();
    view.rerender(<InternalSettlement settlement={{ ...settlement, status: 'unavailable' }} ranked />);
    expect(screen.getAllByLabelText('Unranked')).toHaveLength(4);
    expect(screen.getAllByText('Unavailable', { exact: true })).toHaveLength(4);
    expect(screen.queryByText(/^Due USD/)).not.toBeInTheDocument();
  });
});
