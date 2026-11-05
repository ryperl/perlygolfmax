import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { emptyWorkspace, fictionalId, fictionalWorkspace } from '../../client/catalog.test-support';
import type { EventWorkspace, RoundSnapshot } from '../../domain/setup';
import { EventTripView, summarizeEntryProgress } from './index';
import { fictionalRoundScores, scoreResult } from '../../client/scoring.test-support';

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
    render(<EventTripView workspace={{ ...workspace, canViewScores: true, viewerPlayerId: player.playerId,
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
    expect(screen.getByText('No manual groups saved for this round.')).toBeVisible();
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
