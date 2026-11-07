import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { emptyWorkspace, fictionalId, fictionalWorkspace } from '../../client/catalog.test-support';
import type { EventWorkspace, RoundSnapshot } from '../../domain/setup';
import { EventTripView, summarizeEntryProgress } from './index';
import { fictionalRoundScores, scoreResult, withGameResults } from '../../client/scoring.test-support';
import { stablefordPoints } from '../../domain/stableford';

const openingRound = fictionalWorkspace.rounds[0];
if (!openingRound) throw new Error('Missing fictional round fixture.');
const firstRound: RoundSnapshot = {
  ...openingRound, scoringStarted: true,
  groups: [
    { number: 3, playerIds: [fictionalId(3), fictionalId(1)] },
    { number: 2, playerIds: [] },
  ],
};
const secondRound: RoundSnapshot = {
  ...openingRound, id: fictionalId(71), name: 'Fictional closing round',
  course: { ...openingRound.course, name: 'Fictional Pines' },
  teeProfile: { ...openingRound.teeProfile, name: 'Fictional Gold', totalYardage: 1234, totalPar: 35 },
  groups: [{ number: 4, playerIds: [fictionalId(2), fictionalId(4)] }],
};
const workspace: EventWorkspace = { ...fictionalWorkspace, rounds: [firstRound, secondRound] };
const eventUrl = `event=${encodeURIComponent(workspace.event.id)}`;

function roundCard(name: string) {
  const card = screen.getByRole('heading', { name, level: 3 }).closest('li');
  if (!card) throw new Error('Missing fictional round card.');
  return within(card);
}

describe('saved event overview', () => {
  it('shows the selected game teams below Groups without treating playing groups as competition teams', () => {
    const game = { id: fictionalId(550), name: 'Fictional selected Better Ball', basis: 'net' as const, preset: 'standard' as const,
      format: 'two-net-better-ball' as const, handicapAllowancePercent: 100, points: stablefordPoints('standard'),
      teams: [{ id: fictionalId(551), name: 'Fictional team one', playerIds: [fictionalId(1), fictionalId(3)] },
        { id: fictionalId(552), name: 'Fictional team two', playerIds: [fictionalId(2), fictionalId(4)] }] };
    const round = fictionalWorkspace.rounds[0];
    if (!round) throw new Error('Missing fictional round.');
    const current = { ...fictionalWorkspace, overallCompetition: { kind: 'stableford' as const, credit: 'team' as const,
      roundGames: [{ roundId: round.id, gameId: game.id }] } };
    const progress = { [round.id]: summarizeEntryProgress(current.event.id, round, withGameResults(fictionalRoundScores, [game], 'games'), game.id) };
    const view = render(<EventTripView workspace={current} view="group" progress={progress} />);
    expect(screen.getByRole('heading', { name: 'Groups', level: 4 })).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Manual groups' })).not.toBeInTheDocument();
    expect(screen.getByText('Overall game: Fictional selected Better Ball')).toBeVisible();
    expect(screen.getByText(/2-man net Better Ball/)).toBeVisible();
    const teams = screen.getByRole('region', { name: `Competition teams for ${round.name}` });
    expect(within(teams).getByRole('heading', { name: 'Fictional team one' })).toBeVisible();
    expect(within(teams).getByText('Fictional Player 1')).toBeVisible();
    expect(within(teams).getByText('Fictional Player 3')).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Groups' }).compareDocumentPosition(teams) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    const individual = { id: game.id, name: 'Fictional individual', preset: 'standard' as const, basis: 'gross' as const,
      handicapAllowancePercent: 95, points: stablefordPoints('standard') };
    view.rerender(<EventTripView workspace={current} view="group" progress={{ [round.id]:
      summarizeEntryProgress(current.event.id, round, withGameResults(fictionalRoundScores, [individual], 'next'), game.id) }} />);
    expect(screen.getByText('Individual game — no competition teams.')).toBeVisible();
    expect(screen.queryByText('Fictional team one')).not.toBeInTheDocument();
    const original = progress[round.id];
    if (original?.kind !== 'ready') throw new Error('Missing fictional selected game.');
    view.rerender(<EventTripView workspace={current} view="group" progress={{ [round.id]: {
      kind: 'ready', summary: { ...original.summary, selectedGame: { ...game,
        teams: game.teams.map((team, index) => index === 0 ? { ...team, playerIds: [fictionalId(1), fictionalId(99)] } : team) } },
    } }} />);
    expect(screen.getByText('Saved team assignments need organizer repair before team results are available.')).toBeVisible();
    expect(screen.getByText('Player unavailable')).toBeVisible();
    view.rerender(<EventTripView workspace={current} view="group" progress={{ [round.id]: { kind: 'unavailable' } }} />);
    expect(screen.getByText('Team information unavailable. Refresh event to retry.')).toBeVisible();
    expect(screen.queryByText('Individual game — no competition teams.')).not.toBeInTheDocument();
  });
  it('labels both event range dates and shows missing dates honestly', () => {
    const view = render(<EventTripView workspace={{ ...workspace, event: { ...workspace.event,
      startDate: '2026-11-06', endDate: '2026-11-10' } }} view="overview" />);
    expect(screen.getByText('Event Start').nextElementSibling?.querySelector('time')).toHaveAttribute('datetime', '2026-11-06');
    expect(screen.getByText('Event End').nextElementSibling?.querySelector('time')).toHaveAttribute('datetime', '2026-11-10');
    view.rerender(<EventTripView workspace={workspace} view="overview" />);
    expect(screen.getByText('Event Start').nextElementSibling).toHaveTextContent('Not set');
    expect(screen.getByText('Event End').nextElementSibling).toHaveTextContent('Not set');
  });
  it('distinguishes unselected, loading and unavailable overall games without inventing a name', () => {
    const enabled = { ...workspace, overallCompetition: { kind: 'stableford' as const, credit: 'team' as const,
      roundGames: [{ roundId: firstRound.id, gameId: fictionalId(500) }] } };
    const view = render(<EventTripView workspace={enabled} view="overview" progress={{ [firstRound.id]: { kind: 'loading' } }} />);
    expect(screen.getByText('Overall game: Loading saved game…')).toBeVisible();
    expect(screen.getByText('Overall game: Not selected')).toBeVisible();
    view.rerender(<EventTripView workspace={enabled} view="overview" progress={{ [firstRound.id]: { kind: 'unavailable' } }} />);
    expect(screen.getByText('Overall game: Selected game unavailable — refresh event')).toBeVisible();
    view.rerender(<EventTripView workspace={workspace} view="overview" />);
    expect(screen.queryByText(/Overall game:/)).not.toBeInTheDocument();
  });
  it.each(['overview', 'rounds'] as const)('shows saved event/round dates and chronological rounds on %s without renumbering identities', (view) => {
    const dated: EventWorkspace = { ...workspace, event: { ...workspace.event, startDate: '2024-02-29' }, rounds: [
      { ...firstRound, startDate: '2026-11-08' }, { ...secondRound, startDate: '2026-11-07' },
      { ...firstRound, id: fictionalId(73), name: 'Fictional same day', startDate: '2026-11-08' },
      { ...firstRound, id: fictionalId(74), name: 'Fictional undated' },
    ] };
    render(<EventTripView workspace={dated} view={view} />);
    expect(screen.getByText('February 29, 2024')).toHaveAttribute('datetime', '2024-02-29');
    expect(screen.getAllByRole('heading', { level: 3 }).map((node) => node.textContent)).toEqual([
      secondRound.name, firstRound.name, 'Fictional same day', 'Fictional undated',
    ]);
    expect(roundCard(secondRound.name).getByRole('link', { name: `Open scorecard for ${secondRound.name}` }))
      .toHaveAttribute('href', `#organizer?${eventUrl}&round=${secondRound.id}`);
    expect(dated.rounds[0]?.id).toBe(firstRound.id);
  });
  it.each([['00:00', '12:00 AM'], ['08:30', '8:30 AM'], ['12:00', '12:00 PM'], ['16:15', '4:15 PM']])('shows %s as the round course-local tee time without generated group departures', (teeTime, label) => {
    const view = render(<EventTripView workspace={{ ...workspace, rounds: [{ ...firstRound, teeTime }] }} view="overview" />);
    expect(screen.getByText(`${label} (course local time)`)).toHaveAttribute('datetime', teeTime);
    view.rerender(<EventTripView workspace={workspace} view="overview" />);
    expect(screen.queryByText(/Tee time:/)).not.toBeInTheDocument();
  });
  it('shows purse navigation only for a configured purse and displays actual group starting holes', () => {
    const current = { ...workspace, canViewScores: true, event: { ...workspace.event, role: 'viewer' as const } };
    const view = render(<EventTripView workspace={current} view="overview" />);
    expect(screen.queryByRole('link', { name: 'View purse and winnings' })).not.toBeInTheDocument();
    view.rerender(<EventTripView workspace={{ ...current, purseConfigured: false }} view="overview" />);
    expect(screen.queryByRole('link', { name: 'View purse and winnings' })).not.toBeInTheDocument();
    view.rerender(<EventTripView workspace={{ ...current, purseConfigured: true }} view="overview" />);
    expect(screen.getByRole('link', { name: 'View purse and winnings' })).toBeVisible();
    const round = current.rounds[0];
    if (!round) throw new Error('Missing fictional round.');
    view.rerender(<EventTripView workspace={{ ...current, rounds: [{ ...round,
      groups: round.groups.map((group) => ({ ...group, startingHole: 7 })) }] }} view="rounds" />);
    expect(screen.getAllByText('Starting hole: 7')).toHaveLength(round.groups.length);
  });
  it.each(['overview', 'rounds', 'group'] as const)('lets other-event viewers browse %s without inventing a playing group or access management', (view) => {
    const enabled = { ...workspace, canViewScores: true, event: { ...workspace.event, role: 'viewer' as const } };
    const rendered = render(<EventTripView workspace={enabled} view={view} />);
    expect(screen.getAllByRole('link', { name: /Open scorecard for/ })).toHaveLength(workspace.rounds.length);
    expect(screen.queryByRole('link', { name: /Your playing group|Configure event/ })).not.toBeInTheDocument();
    rendered.rerender(<EventTripView workspace={{ ...enabled, event: { ...enabled.event, status: 'archived' } }} view={view} />);
    expect(screen.getByRole('alert')).toHaveTextContent('event owner only');
    expect(screen.queryByRole('link', { name: /Open scorecard for/ })).not.toBeInTheDocument();
  });
  it('links all admitted scorecards and the bound playing group without exposing organizer setup', () => {
    const player = workspace.roster[0];
    if (!player) throw new Error('Missing fictional player.');
    render(<EventTripView workspace={{ ...workspace, purseConfigured: true, canViewScores: true, viewerPlayerId: player.playerId,
      event: { ...workspace.event, role: 'member' },
      overallCompetition: { kind: 'stroke-play', basis: 'gross' } }} view="rounds" />);
    expect(screen.getAllByRole('link', { name: /Open scorecard for/ })).toHaveLength(workspace.rounds.length);
    expect(screen.getAllByRole('link', { name: /Your playing group/ }).length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: 'Overall leaderboard' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'View purse and winnings' })).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Configure event' })).not.toBeInTheDocument();
  });
  it('links enabled owner overall results from Overview and Rounds only, including archived read-only events', () => {
    const enabled: EventWorkspace = { ...workspace, overallCompetition: { kind: 'stroke-play', basis: 'gross' } };
    const view = render(<EventTripView workspace={enabled} view="overview" />);
    expect(screen.getByRole('link', { name: 'Overall leaderboard' })).toHaveAttribute('href', `#leaderboard?${eventUrl}`);
    view.rerender(<EventTripView workspace={{ ...enabled, event: { ...enabled.event, status: 'archived' } }} view="rounds" />);
    expect(screen.getByRole('link', { name: 'Overall leaderboard' })).toBeVisible();
    view.rerender(<EventTripView workspace={enabled} view="group" />);
    expect(screen.queryByRole('link', { name: 'Overall leaderboard' })).not.toBeInTheDocument();
    view.rerender(<EventTripView workspace={workspace} view="overview" />);
    expect(screen.queryByRole('link', { name: 'Overall leaderboard' })).not.toBeInTheDocument();
    view.rerender(<EventTripView workspace={{ ...enabled, canViewScores: true, event: { ...enabled.event, role: 'member' } }} view="overview" />);
    expect(screen.getByRole('link', { name: 'Overall leaderboard' })).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Configure event' })).not.toBeInTheDocument();
  });
  it('uses the selected workspace, actual counts, and saved-round order and links', () => {
    render(<EventTripView workspace={workspace} view="overview" />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(workspace.event.name);
    expect(screen.getByText(workspace.location)).toBeVisible();
    const stats = screen.getByRole('region', { name: 'Event at a glance' });
    expect(within(stats).getByText('Golfers on roster').nextElementSibling).toHaveTextContent('4');
    expect(within(stats).getByText('Saved rounds').nextElementSibling).toHaveTextContent('2');
    expect(screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent))
      .toEqual([firstRound.name, secondRound.name]);
    expect(roundCard(secondRound.name).getByText('Fictional Pines')).toBeVisible();
    expect(roundCard(secondRound.name).getByText('Fictional Gold tees')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Configure event' })).toHaveAttribute('href', `#organizer?${eventUrl}`);
    for (const round of workspace.rounds) {
      expect(screen.getByRole('link', { name: `Open scorecard for ${round.name}` }))
        .toHaveAttribute('href', `#organizer?${eventUrl}&round=${encodeURIComponent(round.id)}`);
    }
    expect(screen.queryByText(/completed|today|tee time|handicap|demo/i)).not.toBeInTheDocument();
  });

  it('shows honest empty states without assuming a location, roster, or opening round', () => {
    render(<EventTripView workspace={emptyWorkspace} view="overview" />);
    expect(screen.getByText('No location saved.')).toBeVisible();
    expect(screen.getByText('No golfers saved to this event roster.')).toBeVisible();
    expect(screen.getByText('No rounds saved for this event.')).toBeVisible();
    expect(screen.getAllByText('0')).toHaveLength(2);
    expect(screen.queryByRole('link', { name: /scorecard/i })).not.toBeInTheDocument();
  });
});

describe('saved event rounds', () => {
  it('shows captured course/tee totals and manual group order without inferring completion', () => {
    render(<EventTripView workspace={workspace} view="rounds" />);
    expect(screen.getByRole('heading', { level: 1, name: 'Rounds' })).toBeVisible();
    const first = roundCard(firstRound.name);
    expect(first.getAllByRole('heading', { level: 5 }).map((heading) => heading.textContent))
      .toEqual(['Group 3', 'Group 2', 'Not assigned to a group']);
    const group = first.getByRole('heading', { name: 'Group 3' }).closest('li');
    if (!group) throw new Error('Missing fictional group.');
    expect(within(group).getAllByRole('listitem').map((item) => item.textContent))
      .toEqual(['Fictional Player 3', 'Fictional Player 1']);
    expect(first.getByText('No players assigned.')).toBeVisible();
    const closing = roundCard(secondRound.name);
    expect(closing.getByText('Yards').nextElementSibling).toHaveTextContent('1,234');
    expect(closing.getByText('Par').nextElementSibling).toHaveTextContent('35');
    expect(closing.getByText('Holes').nextElementSibling).toHaveTextContent('9');
    expect(closing.getByRole('link', { name: /Open scorecard/ })).toBeVisible();
    expect(screen.queryByText(/completed/i)).not.toBeInTheDocument();
  });

  it('handles a round with no groups or players, then an empty rounds list', () => {
    const view = render(<EventTripView
      workspace={{ ...workspace, rounds: [{ ...firstRound, groups: [], players: [] }] }} view="rounds"
    />);
    expect(screen.getByText('No groups saved for this round.')).toBeVisible();
    expect(screen.getByText('No players saved for this round.')).toBeVisible();
    view.rerender(<EventTripView workspace={emptyWorkspace} view="rounds" />);
    expect(screen.getByText('No rounds saved for this event.')).toBeVisible();
    expect(screen.queryByRole('heading', { level: 3 })).not.toBeInTheDocument();
  });
});

describe('saved event group', () => {
  it('preserves roster order and distinguishes per-round groups and account access', () => {
    render(<EventTripView workspace={workspace} view="group" />);
    const roster = screen.getByRole('region', { name: 'Event roster' });
    expect(within(roster).getAllByRole('listitem').map((item) => item.textContent))
      .toEqual(workspace.roster.map((player) => player.displayName));
    expect(within(roster).getByText(/not a list of sign-in accounts or access permissions/)).toBeVisible();
    expect(roundCard(firstRound.name).getByRole('heading', { name: 'Group 3' })).toBeVisible();
    expect(roundCard(secondRound.name).getByRole('heading', { name: 'Group 4' })).toBeVisible();
    expect(screen.queryByText(/handicap|invitation|net score/i)).not.toBeInTheDocument();
  });

  it('shows missing roster and round states without inventing players or assignments', () => {
    render(<EventTripView workspace={emptyWorkspace} view="group" />);
    expect(screen.getByText('No golfers saved to this event roster.')).toBeVisible();
    expect(screen.getByText('No rounds saved for this event.')).toBeVisible();
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument();
  });

  it('uses round player snapshots for assignments rather than silently replacing saved names', () => {
    render(<EventTripView workspace={{
      ...workspace,
      roster: [{ playerId: fictionalId(1), displayName: 'Fictional renamed golfer' }],
      rounds: [{ ...firstRound, groups: [{ number: 1, playerIds: [fictionalId(1), fictionalId(99)] }] }],
    }} view="group" />);
    expect(screen.getByRole('region', { name: 'Event roster' })).toHaveTextContent('Fictional renamed golfer');
    expect(roundCard(firstRound.name).getByText('Fictional Player 1')).toBeVisible();
    expect(roundCard(firstRound.name).getByText('Player unavailable')).toBeVisible();
    expect(screen.queryByText(fictionalId(99))).not.toBeInTheDocument();
  });
});

describe.each(['overview', 'rounds', 'group'] as const)('saved %s navigation and state', (view) => {
  it('shows the same authoritative round and group progress on every tab', () => {
    render(<EventTripView workspace={fictionalWorkspace} view={view} progress={{
      [fictionalRoundScores.roundId]: summarizeEntryProgress(fictionalWorkspace.event.id, openingRound, scoreResult().round),
    }} />);
    const progress = screen.getByRole('region', { name: 'Saved entry progress' });
    expect(progress).toHaveTextContent('Saved entry progress: In progress');
    expect(progress).toHaveTextContent('Group 1 · In progress · 0/9 holes');
    expect(progress).toHaveAccessibleDescription('A hole counts when every golfer in that group has a saved entry.');
    expect(screen.getAllByText('Saved entries, not finalization. Includes pickups and DNF.')).toHaveLength(1);
  });

  it('does not infer progress from setup locks and hides supplied private progress from members', () => {
    const rendered = render(<EventTripView workspace={workspace} view={view} />);
    expect(screen.getAllByText('Progress unavailable. Use Refresh event to retry.')).toHaveLength(2);
    expect(screen.queryByText('No scores yet')).not.toBeInTheDocument();
    rendered.rerender(<EventTripView workspace={{ ...fictionalWorkspace, event: { ...fictionalWorkspace.event, role: 'member' } }} view={view}
      progress={{ [fictionalRoundScores.roundId]: summarizeEntryProgress(fictionalWorkspace.event.id, openingRound, scoreResult().round) }} />);
    expect(screen.getByText('Entry progress requires approved player access.')).toBeVisible();
    expect(screen.queryByRole('region', { name: 'Saved entry progress' })).not.toBeInTheDocument();
  });

  it('provides keyboard-accessible setup and scorecard actions without duplicating main navigation', async () => {
    const user = userEvent.setup();
    render(<EventTripView workspace={workspace} view={view} />);
    const nav = screen.getByRole('navigation', { name: 'Event setup' });
    const links = within(nav).getAllByRole('link');
    for (const link of links) {
      await user.tab();
      expect(link).toHaveFocus();
    }
    expect(within(nav).getByRole('link', { name: 'Configure event' })).toHaveAttribute('href', `#organizer?${eventUrl}`);
    expect(screen.queryByRole('link', { name: 'Overview' })).not.toBeInTheDocument();
    await user.tab();
    expect(screen.getByRole('link', { name: `Open scorecard for ${firstRound.name}` })).toHaveFocus();
  });

  it('makes archived read-only state explicit and hides owner actions for members', () => {
    const archived: EventWorkspace = { ...workspace, event: { ...workspace.event, status: 'archived' } };
    const rendered = render(<EventTripView workspace={archived} view={view} />);
    expect(screen.getByText('Archived event · Read-only')).toBeVisible();
    expect(screen.getByRole('link', { name: 'View event setup' })).toHaveAttribute('href', `#organizer?${eventUrl}`);
    expect(screen.queryByRole('link', { name: 'Configure event' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    rendered.rerender(<EventTripView workspace={{ ...workspace, event: { ...workspace.event, role: 'member' } }} view={view} />);
    expect(screen.queryByRole('link', { name: /Configure event|View event setup|scorecard/i })).not.toBeInTheDocument();
    expect(screen.queryByText('Archived event · Read-only')).not.toBeInTheDocument();
  });

  it('does not expose raw workspace metadata', () => {
    render(<EventTripView workspace={workspace} view={view} />);
    for (const value of [workspace.event.id, workspace.etag, workspace.event.createdAt, firstRound.courseVersionId]) {
      expect(screen.queryByText(value, { exact: false })).not.toBeInTheDocument();
    }
  });
});
