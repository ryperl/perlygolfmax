import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { EventChangedError } from '../../client/events';
import { PrivateRequestError } from '../../client/private-request';
import { fakeScores } from '../../client/scoring.test-support';
import {
  emptyWorkspace, fakeCatalog, fakeSetup, fictionalEvent, fictionalPlayers, fictionalManifest,
  fictionalProfile, fictionalVersion, fictionalWorkspace, fictionalId, fictionalEntry, fictionalSetup,
} from '../../client/catalog.test-support';
import type { CourseCatalogPage, CourseVersion, IndexObservation, PlayerCatalogPage } from '../../domain/catalog';
import type { EventSetupInput, EventWorkspace } from '../../domain/setup';
import { EventWorkspaceView } from './EventWorkspaceView';

const oldIndex: IndexObservation = {
  id: fictionalId(301), value: '10.2', effectiveDate: '2026-01-01', source: 'Fictional manual report',
  recordedAt: '2026-01-01T00:00:00Z', recordedBy: { tenantId: fictionalId(201), objectId: fictionalId(202) },
  previousObservationId: null,
};
const latestIndex: IndexObservation = { ...oldIndex, id: fictionalId(302), value: '+1.2', effectiveDate: '2026-02-01', previousObservationId: oldIndex.id };
const capturedWorkspace: EventWorkspace = { ...fictionalWorkspace, rounds: fictionalWorkspace.rounds.map((round) => ({
  ...round, players: round.players.map((player, index) => ({ ...player, handicapIndex: index === 0 ? oldIndex : null })),
})) };
const currentPlayers = fictionalPlayers.map((player, index) => ({ ...player, currentIndex: index === 0 ? latestIndex : null }));
const refreshedWorkspace: EventWorkspace = {
  ...capturedWorkspace, event: { ...fictionalEvent, etag: 'workspace-v2' }, etag: 'workspace-v2',
  rounds: capturedWorkspace.rounds.map((round) => ({ ...round, players: round.players.map((player, index) => ({
    ...player, handicapIndex: index === 0 ? latestIndex : null,
  })) })),
};
function indexRow(name: string) {
  const row = screen.getByRole('heading', { name, level: 4 }).closest('li');
  if (!row) throw new Error('Missing captured-index player row.');
  return within(row);
}

function savedInput(input: EventSetupInput): EventWorkspace {
  return {
    ...fictionalWorkspace, event: { ...fictionalEvent, name: input.name, etag: 'workspace-v2' },
    etag: 'workspace-v2', location: input.location,
    roster: fictionalWorkspace.roster.filter((player) => input.playerIds.includes(player.playerId)),
    allowPerGolferTees: input.allowPerGolferTees ?? false,
    ...(input.overallCompetition == null ? {} : { overallCompetition: input.overallCompetition }),
    rounds: input.rounds.map((round) => ({
      id: round.id, name: round.name, courseId: round.courseId, courseVersionId: round.courseVersionId,
      teeProfile: fictionalVersion.data.teeProfiles.find((profile) => profile.id === round.teeProfileId) ?? fictionalProfile,
      course: fictionalManifest.course, groups: round.groups,
      playerTees: (round.playerTeeSelections ?? []).map((entry) => ({
        playerId: entry.playerId,
        profile: fictionalVersion.data.teeProfiles.find((profile) => profile.id === entry.teeProfileId) ?? fictionalProfile,
      })),
      players: fictionalPlayers.filter((player) => input.playerIds.includes(player.id))
        .map((player) => ({ playerId: player.id, displayName: player.displayName, handicapIndex: null })),
    })),
  };
}
async function configureRound(user: ReturnType<typeof userEvent.setup>, number: number) {
  await user.type(screen.getByLabelText(`Round ${String(number)} name`), `Fictional round ${String(number)}`);
  await user.selectOptions(screen.getByLabelText(`Round ${String(number)} course`), fictionalVersion.courseId);
  expect(screen.getByLabelText(`Round ${String(number)} course version`)).toHaveValue('');
  await user.selectOptions(screen.getByLabelText(`Round ${String(number)} course version`), fictionalVersion.id);
  const tee = screen.getByLabelText(`Round ${String(number)} tee profile`);
  await waitFor(() => { expect(tee).toBeEnabled(); });
  expect(tee).toHaveValue('');
  await user.selectOptions(tee, '905');
  for (const [index, player] of fictionalPlayers.entries()) {
    await user.selectOptions(screen.getByLabelText(`${player.displayName} — round ${String(number)} group`), String(index + 1));
  }
}

async function openSetupSections(user = userEvent.setup()) {
  await screen.findByRole('heading', { name: 'Configure event setup' });
  for (const name of ['1. Event details', /2. Players \(/, 'Saved round inputs and handicap review']) {
    const summary = screen.queryByText(name);
    if (summary?.closest('details')?.open === false) await user.click(summary);
  }
}

describe('saved event workspace', () => {
  it.each([1, 2, 3])('saves a complete %i-player workspace while still blocking an empty roster', async (count) => {
    const setup = fakeSetup();
    vi.mocked(setup.load).mockResolvedValue(fictionalWorkspace);
    vi.mocked(setup.save).mockImplementation((_event, _etag, input) => Promise.resolve(savedInput(input)));
    render(<EventWorkspaceView eventId={fictionalEvent.id} canManageCatalog setup={setup} catalog={fakeCatalog()} />);
    const user = userEvent.setup();
    await openSetupSections(user);
    for (const player of fictionalPlayers.slice(count)) {
      const checkbox = screen.getByLabelText(`${player.displayName} — HI Unknown`);
      await waitFor(() => { expect(checkbox).toBeEnabled(); });
      await user.click(checkbox);
    }
    const save = screen.getByRole('button', { name: 'Save event workspace' });
    await waitFor(() => { expect(save).toBeEnabled(); });
    await user.click(save);
    await screen.findByText(/Event workspace saved/);
    const submitted = vi.mocked(setup.save).mock.calls[0]?.[2];
    expect(submitted?.playerIds).toEqual(fictionalPlayers.slice(0, count).map((player) => player.id));
    expect(submitted?.rounds[0]?.groups[0]?.playerIds).toEqual(submitted?.playerIds);
    for (const player of fictionalPlayers.slice(0, count)) {
      await user.click(screen.getByLabelText(`${player.displayName} — HI Unknown`));
    }
    expect(screen.getByText('Choose at least one player.')).toBeVisible();
    expect(save).toBeDisabled();
    expect(setup.save).toHaveBeenCalledOnce();
  });
  it('retains accumulated course and player pages across quota waits and retries only the throttled page', async () => {
    vi.useFakeTimers();
    const catalog = fakeCatalog();
    const otherCourse = { ...fictionalEntry, id: 'ghin:902:904', name: 'Fictional later course' };
    vi.mocked(catalog.courses).mockResolvedValueOnce({ courses: [fictionalEntry], continuationToken: 'course-next' })
      .mockRejectedValueOnce(new PrivateRequestError(429, 'Course quota reached.', 2))
      .mockResolvedValueOnce({ courses: [otherCourse] });
    vi.mocked(catalog.players).mockResolvedValueOnce({ players: fictionalPlayers.slice(0, 2), continuationToken: 'player-next' })
      .mockRejectedValueOnce(new PrivateRequestError(429, 'Player quota reached.', 3))
      .mockResolvedValueOnce({ players: fictionalPlayers.slice(2) });
    const view = render(<EventWorkspaceView eventId={fictionalEvent.id} canManageCatalog setup={fakeSetup()} catalog={catalog} />);
    try {
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      expect(catalog.courses).toHaveBeenCalledTimes(2);
      expect(catalog.players).not.toHaveBeenCalled();
      expect(screen.getByText('Loading saved catalog selections...')).toBeVisible();
      expect(screen.getByLabelText('Workspace name')).toBeDisabled();
      expect(screen.queryByRole('checkbox', { name: /Fictional Player/ })).not.toBeInTheDocument();
      await act(async () => { await vi.advanceTimersByTimeAsync(1999); });
      expect(catalog.courses).toHaveBeenCalledTimes(2);
      await act(async () => { await vi.advanceTimersByTimeAsync(1); });
      expect(vi.mocked(catalog.courses).mock.calls.map((call) => call[1])).toEqual([undefined, 'course-next', 'course-next']);
      expect(vi.mocked(catalog.players).mock.calls.map((call) => call[1])).toEqual([undefined, 'player-next']);
      expect(screen.getByLabelText('Workspace name')).toBeDisabled();
      expect(screen.queryByRole('checkbox', { name: /Fictional Player/ })).not.toBeInTheDocument();
      await act(async () => { await vi.advanceTimersByTimeAsync(2999); });
      expect(catalog.players).toHaveBeenCalledTimes(2);
      await act(async () => { await vi.advanceTimersByTimeAsync(1); });
      expect(vi.mocked(catalog.players).mock.calls.map((call) => call[1])).toEqual([undefined, 'player-next', 'player-next']);
      expect(catalog.courses).toHaveBeenCalledTimes(3);
      expect(screen.getByLabelText('Workspace name')).toBeEnabled();
      for (const player of fictionalPlayers) expect(screen.getByLabelText(`${player.displayName} — HI Unknown`)).toBeVisible();
      act(() => { screen.getByRole('button', { name: 'Add Round' }).click(); });
      const courses = screen.getByLabelText('Round 1 course');
      expect(within(courses).getByRole('option', { name: /Fictional Meadows/ })).toBeVisible();
      expect(within(courses).getByRole('option', { name: /Fictional later course/ })).toBeVisible();
      expect(screen.queryByText('Loading saved catalog selections...')).not.toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    } finally { view.unmount(); vi.useRealTimers(); }
  });

  it.each(['courses', 'players'] as const)('cancels a quota wait between %s pages without retrying or publishing partial selections', async (kind) => {
    vi.useFakeTimers();
    const scheduled = vi.spyOn(globalThis, 'setTimeout');
    const cancelled = vi.spyOn(globalThis, 'clearTimeout');
    const catalog = fakeCatalog();
    if (kind === 'courses') {
      vi.mocked(catalog.courses).mockResolvedValueOnce({ courses: [fictionalEntry], continuationToken: 'course-next' })
        .mockRejectedValue(new PrivateRequestError(429, 'Course quota reached.', 2));
    } else {
      vi.mocked(catalog.players).mockResolvedValueOnce({ players: fictionalPlayers.slice(0, 2), continuationToken: 'player-next' })
        .mockRejectedValue(new PrivateRequestError(429, 'Player quota reached.', 2));
    }
    const view = render(<EventWorkspaceView eventId={fictionalEvent.id} canManageCatalog setup={fakeSetup()} catalog={catalog} />);
    try {
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      expect(catalog[kind]).toHaveBeenCalledTimes(2);
      const signal = vi.mocked(catalog[kind]).mock.calls[1]?.[0];
      expect(signal?.aborted).toBe(false);
      expect(screen.getByLabelText('Workspace name')).toBeDisabled();
      expect(screen.queryByRole('checkbox', { name: /Fictional Player/ })).not.toBeInTheDocument();
      const waitIndex = scheduled.mock.calls.findIndex((call) => call[1] === 2000);
      expect(waitIndex).toBeGreaterThanOrEqual(0);
      const waitTimer = scheduled.mock.results[waitIndex];
      if (!waitTimer || waitTimer.type !== 'return') throw new Error('Missing catalog quota wait timer.');
      view.unmount();
      expect(signal?.aborted).toBe(true);
      expect(cancelled).toHaveBeenCalledWith(waitTimer.value);
      await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
      expect(catalog[kind]).toHaveBeenCalledTimes(2);
    } finally { view.unmount(); scheduled.mockRestore(); cancelled.mockRestore(); vi.useRealTimers(); }
  });

  it('keeps ordinary page errors explicit instead of publishing accumulated partial catalogues or retrying them automatically', async () => {
    const catalog = fakeCatalog();
    vi.mocked(catalog.players).mockResolvedValueOnce({ players: fictionalPlayers.slice(0, 2), continuationToken: 'player-next' })
      .mockRejectedValueOnce(new PrivateRequestError(503, 'Later player page unavailable.', 3));
    render(<EventWorkspaceView eventId={fictionalEvent.id} canManageCatalog setup={fakeSetup()} catalog={catalog} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Later player page unavailable.');
    expect(vi.mocked(catalog.players).mock.calls.map((call) => call[1])).toEqual([undefined, 'player-next']);
    expect(screen.getByLabelText('Workspace name')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Retry catalog selections' })).toBeEnabled();
    expect(screen.queryByRole('checkbox', { name: /Fictional Player/ })).not.toBeInTheDocument();
  });

  it('saves explicit personal-tee permission and all round selections across round switches and a conflict refresh', async () => {
    const first = fictionalWorkspace.rounds[0];
    if (!first) throw new Error('Missing fictional round.');
    const second = { ...first, id: fictionalId(71), name: 'Fictional later round' };
    const workspace: EventWorkspace = { ...fictionalWorkspace, rounds: [first, second] };
    const setup = fakeSetup();
    vi.mocked(setup.load).mockResolvedValue(workspace);
    vi.mocked(setup.save).mockRejectedValueOnce(new EventChangedError('Refresh and review personal tees.'))
      .mockImplementation((_id, _etag, input) => Promise.resolve(savedInput(input)));
    const user = userEvent.setup();
    render(<EventWorkspaceView eventId={fictionalEvent.id} canManageCatalog setup={setup} catalog={fakeCatalog()} />);
    await openSetupSections(user);
    await waitFor(() => { expect(screen.getByLabelText('Allow organizer-assigned personal tees')).toBeEnabled(); });
    expect(screen.queryByLabelText('Fictional Player 1 — round 1 tee')).not.toBeInTheDocument();
    await user.click(screen.getByLabelText('Allow organizer-assigned personal tees'));
    await user.selectOptions(screen.getByLabelText('Fictional Player 1 — round 1 tee'), '905');
    await user.selectOptions(screen.getByLabelText('Selected round'), second.id);
    await user.selectOptions(screen.getByLabelText('Fictional Player 2 — round 2 tee'), '905');
    await user.selectOptions(screen.getByLabelText('Selected round'), first.id);
    expect(screen.getByLabelText('Fictional Player 1 — round 1 tee')).toHaveValue('905');
    await user.click(screen.getByRole('button', { name: 'Save event workspace' }));
    await screen.findByText('Refresh and review personal tees.');
    await user.click(screen.getByRole('button', { name: 'Refresh workspace' }));
    await screen.findByText(/Workspace refreshed/);
    expect(screen.getByLabelText('Allow organizer-assigned personal tees')).toBeChecked();
    expect(screen.getByLabelText('Fictional Player 1 — round 1 tee')).toHaveValue('905');
    await user.click(screen.getByRole('button', { name: 'Save event workspace' }));
    await screen.findByText(/Event workspace saved/);
    const input = vi.mocked(setup.save).mock.calls[1]?.[2];
    expect(input?.allowPerGolferTees).toBe(true);
    expect(input?.rounds[0]?.playerTeeSelections).toEqual([{ playerId: fictionalId(1), teeProfileId: 905 }]);
    expect(input?.rounds[1]?.playerTeeSelections).toEqual([{ playerId: fictionalId(2), teeProfileId: 905 }]);
    expect(screen.getByRole('list', { name: `${first.name} assigned tees` })).toHaveTextContent('Fictional Player 1: Fictional Teal / Fictional B · personal tee');
    await user.click(screen.getByLabelText('Allow organizer-assigned personal tees'));
    await user.click(screen.getByRole('button', { name: 'Save event workspace' }));
    await waitFor(() => { expect(setup.save).toHaveBeenCalledTimes(3); });
    expect(vi.mocked(setup.save).mock.calls[2]?.[2]).toMatchObject({
      allowPerGolferTees: false, rounds: [{ playerTeeSelections: [] }, { playerTeeSelections: [] }],
    });
  });

  it('prevents disabling captured personal tees after scoring, while unscored round choices remain editable', async () => {
    const first = fictionalWorkspace.rounds[0];
    if (!first) throw new Error('Missing fictional round.');
    const workspace: EventWorkspace = { ...fictionalWorkspace, allowPerGolferTees: true, rounds: [
      { ...first, scoringStarted: true, playerTees: [{ playerId: fictionalId(1), profile: fictionalVersion.data.teeProfiles[1] ?? fictionalProfile }] },
      { ...first, id: fictionalId(71), name: 'Fictional unscored round' },
    ] };
    const setup = fakeSetup();
    vi.mocked(setup.load).mockResolvedValue(workspace);
    render(<EventWorkspaceView eventId={fictionalEvent.id} canManageCatalog setup={setup} catalog={fakeCatalog()} />);
    const user = userEvent.setup();
    await openSetupSections(user);
    const flag = screen.getByLabelText('Allow organizer-assigned personal tees');
    expect(flag).toBeChecked();
    expect(flag).toBeDisabled();
    expect(screen.getByText(/Personal tees cannot be disabled/)).toBeVisible();
    expect(screen.getByLabelText('Fictional Player 1 — round 1 tee')).toBeDisabled();
    await user.selectOptions(screen.getByLabelText('Selected round'), fictionalId(71));
    expect(screen.getByLabelText('Fictional Player 1 — round 2 tee')).toBeEnabled();
    await user.selectOptions(screen.getByLabelText('Fictional Player 1 — round 2 tee'), '905');
    expect(screen.getByLabelText('Fictional Player 1 — round 2 tee')).toHaveValue('905');
  });

  it.each([401, 403, 404])('clears private setup after a course-version option read denies access with %i', async (status) => {
    const setup = fakeSetup();
    vi.mocked(setup.load).mockResolvedValue(fictionalWorkspace);
    const catalog = fakeCatalog();
    vi.mocked(catalog.version).mockRejectedValue(new PrivateRequestError(status, 'Protected course version unavailable'));
    const expired = vi.fn();
    render(<EventWorkspaceView eventId={fictionalEvent.id} canManageCatalog setup={setup} catalog={catalog} onSessionExpired={expired} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Protected course version unavailable');
    expect(screen.queryByLabelText('Round 1 name')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Workspace name')).not.toBeInTheDocument();
    expect(expired).toHaveBeenCalledTimes(status === 401 ? 1 : 0);
  });
  it.each([401, 403, 404])('clears private setup after the player catalog denies access with %i', async (status) => {
    const setup = fakeSetup();
    vi.mocked(setup.load).mockResolvedValue(fictionalWorkspace);
    const catalog = fakeCatalog();
    vi.mocked(catalog.players).mockRejectedValue(new PrivateRequestError(status, 'Protected golfers unavailable'));
    const expired = vi.fn();
    render(<EventWorkspaceView eventId={fictionalEvent.id} canManageCatalog setup={setup} catalog={catalog} onSessionExpired={expired} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Protected golfers unavailable');
    expect(screen.queryByLabelText('Workspace name')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Round 1 name')).not.toBeInTheDocument();
    expect(expired).toHaveBeenCalledTimes(status === 401 ? 1 : 0);
  });
  it('hides the entire previous setup and aborts option reads on source changes, including A→B→A', async () => {
    const setup = fakeSetup();
    const workspace: EventWorkspace = { ...fictionalWorkspace,
      overallCompetition: { kind: 'stableford', credit: 'team', roundGames: [] } };
    let finish: ((value: EventWorkspace) => void) | undefined;
    const pending = new Promise<EventWorkspace>((resolve) => { finish = resolve; });
    vi.mocked(setup.load).mockResolvedValueOnce(workspace).mockReturnValueOnce(pending).mockReturnValueOnce(pending);
    const scores = fakeScores();
    vi.mocked(scores.load).mockImplementation(() => new Promise(() => undefined));
    const props = { eventId: fictionalEvent.id, canManageCatalog: true, setup, catalog: fakeCatalog(), scores };
    const view = render(<EventWorkspaceView {...props} />);
    await screen.findByRole('checkbox', { name: 'Enable overall leaderboard' });
    const signal = vi.mocked(scores.load).mock.calls[0]?.[2];
    view.rerender(<EventWorkspaceView {...props} eventId={fictionalId(51)} />);
    expect(screen.queryByRole('checkbox', { name: 'Enable overall leaderboard' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Round 1 name')).not.toBeInTheDocument();
    expect(signal?.aborted).toBe(true);
    view.rerender(<EventWorkspaceView {...props} />);
    expect(screen.queryByRole('checkbox', { name: 'Enable overall leaderboard' })).not.toBeInTheDocument();
    await act(async () => { finish?.(workspace); await pending; });
    expect(screen.getByRole('checkbox', { name: 'Enable overall leaderboard' })).toBeVisible();
    expect(scores.load).toHaveBeenCalledTimes(2);
  });
  it('saves enabled competition and explicit disable independently of scored roster/round locks', async () => {
    const setup = fakeSetup();
    const scored: EventWorkspace = { ...fictionalWorkspace, rounds: fictionalWorkspace.rounds.map((round) => ({ ...round, scoringStarted: true })) };
    vi.mocked(setup.load).mockResolvedValue(scored);
    vi.mocked(setup.save).mockImplementation((_id, _etag, input) => Promise.resolve({ ...savedInput(input), rounds: scored.rounds }));
    const scores = fakeScores();
    render(<EventWorkspaceView eventId={fictionalEvent.id} canManageCatalog setup={setup} catalog={fakeCatalog()} scores={scores} />);
    const user = userEvent.setup();
    const enable = await screen.findByRole('checkbox', { name: 'Enable overall leaderboard' });
    await user.click(enable);
    await user.selectOptions(screen.getByLabelText('Competition'), 'stroke-play');
    await user.selectOptions(screen.getByLabelText('Stroke basis'), 'net');
    const save = screen.getByRole('button', { name: 'Save event workspace' });
    await waitFor(() => { expect(save).toBeEnabled(); });
    await user.click(save);
    await screen.findByText(/Event workspace saved/);
    expect(setup.save).toHaveBeenLastCalledWith(fictionalEvent.id, scored.etag, {
      ...fictionalSetup, allowPerGolferTees: false,
      rounds: fictionalSetup.rounds.map((round) => ({ ...round, playerTeeSelections: [] })),
      overallCompetition: { kind: 'stroke-play', basis: 'net', handicapAllowancePercent: 95 },
    }, expect.any(AbortSignal));
    expect(screen.getByLabelText('Round 1 name')).toBeDisabled();
    await user.click(enable);
    await user.click(save);
    await waitFor(() => { expect(setup.save).toHaveBeenCalledTimes(2); });
    expect(vi.mocked(setup.save).mock.calls[1]?.[2].overallCompetition).toBeNull();
    expect(screen.getByLabelText('Round 1 name')).toBeDisabled();
  });
  it('retains the saved configuration and a changed allowance across conflict review/refresh without unlocking scored inputs', async () => {
    const setup = fakeSetup();
    const workspace: EventWorkspace = { ...fictionalWorkspace,
      overallCompetition: { kind: 'stroke-play', basis: 'net', handicapAllowancePercent: 90 },
      rounds: fictionalWorkspace.rounds.map((round) => ({ ...round, scoringStarted: true })),
    };
    vi.mocked(setup.load).mockResolvedValue(workspace);
    vi.mocked(setup.save).mockRejectedValueOnce(new EventChangedError('Refresh and review the current event.'));
    render(<EventWorkspaceView eventId={fictionalEvent.id} canManageCatalog setup={setup} catalog={fakeCatalog()} scores={fakeScores()} />);
    const user = userEvent.setup();
    const allowance = await screen.findByLabelText('Net handicap allowance (%)');
    expect(allowance).toHaveValue(90);
    await user.clear(allowance);
    await user.type(allowance, '85');
    const save = screen.getByRole('button', { name: 'Save event workspace' });
    await waitFor(() => { expect(save).toBeEnabled(); });
    await user.click(save);
    await screen.findByText('Refresh and review the current event.');
    expect(save).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Refresh workspace' }));
    await screen.findByText(/Workspace refreshed\./);
    expect(allowance).toHaveValue(85);
    expect(screen.getByLabelText('Round 1 name')).toBeDisabled();
    expect(save).toBeEnabled();
  });
  it.each([401, 403, 404])('clears and locks private setup when saved-game options return %s', async (status) => {
    const setup = fakeSetup();
    vi.mocked(setup.load).mockResolvedValue({ ...fictionalWorkspace,
      overallCompetition: { kind: 'stableford', credit: 'individual', roundGames: [] },
    });
    const scores = fakeScores();
    vi.mocked(scores.load).mockRejectedValue(new PrivateRequestError(status, 'Protected game selections unavailable'));
    const expired = vi.fn();
    render(<EventWorkspaceView eventId={fictionalEvent.id} canManageCatalog setup={setup} catalog={fakeCatalog()} scores={scores} onSessionExpired={expired} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Protected game selections unavailable');
    expect(screen.queryByRole('checkbox', { name: 'Enable overall leaderboard' })).not.toBeInTheDocument();
    expect(screen.queryByText(fictionalWorkspace.event.name)).not.toBeInTheDocument();
    expect(expired).toHaveBeenCalledTimes(status === 401 ? 1 : 0);
    expect(setup.save).not.toHaveBeenCalled();
  });
  it('focuses one round, distinguishes unsaved changes and retains drafts when switching or adding rounds', async () => {
    const setup = fakeSetup();
    vi.mocked(setup.load).mockResolvedValue(fictionalWorkspace);
    const user = userEvent.setup();
    render(<EventWorkspaceView eventId={fictionalEvent.id} canManageCatalog setup={setup} catalog={fakeCatalog()} />);
    const first = await screen.findByLabelText('Round 1 name');
    await waitFor(() => { expect(first).toBeEnabled(); });
    expect(first).toBeVisible();
    expect(screen.getByLabelText('Workspace name')).not.toBeVisible();
    expect(screen.getByRole('heading', { name: 'Fictional Player 1', level: 4 })).not.toBeVisible();
    expect(screen.getByText(/^Matches saved setup\./)).toBeVisible();
    expect(screen.getByRole('link', { name: 'View event overview' })).toHaveAttribute('href', `#overview?event=${fictionalEvent.id}`);
    await user.clear(first);
    await user.type(first, 'Fictional changed first round');
    expect(screen.getByText(/^Unsaved changes\./)).toBeVisible();
    expect(screen.getByRole('option', { selected: true, name: /Fictional changed first round — Unsaved changes/ })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add Round' }));
    const second = screen.getByLabelText('Round 2 name');
    expect(second).toBeVisible();
    expect(first).not.toBeVisible();
    await user.type(second, 'Fictional second round draft');
    const picker = screen.getByLabelText('Selected round');
    if (!(picker instanceof HTMLSelectElement)) throw new Error('Missing round selector.');
    const secondId = picker.value;
    await user.selectOptions(picker, fictionalId(70));
    expect(first).toBeVisible();
    expect(first).toHaveValue('Fictional changed first round');
    expect(second).not.toBeVisible();
    expect(screen.getByRole('complementary', { name: 'Setup needs attention' })).toHaveTextContent('Round 2: choose a saved course.');
    expect(screen.getByRole('button', { name: 'Save event workspace' })).toBeDisabled();
    await user.selectOptions(picker, secondId);
    expect(second).toHaveValue('Fictional second round draft');
    expect(second).toBeVisible();
    expect(setup.save).not.toHaveBeenCalled();
  });

  it.each(['first', 'second'] as const)('keeps hidden-round version requests alive and saves all drafts (%s finishes first)', async (earlier) => {
    const setup = fakeSetup();
    const workspace: EventWorkspace = { ...fictionalWorkspace, rounds: [
      ...fictionalWorkspace.rounds,
      ...fictionalWorkspace.rounds.map((round) => ({ ...round, id: fictionalId(71), name: 'Fictional second round' })),
    ] };
    vi.mocked(setup.load).mockResolvedValue(workspace);
    vi.mocked(setup.save).mockImplementation((_id, _etag, input) => Promise.resolve(savedInput(input)));
    const catalog = fakeCatalog();
    let finishFirst: ((version: CourseVersion) => void) | undefined;
    let finishSecond: ((version: CourseVersion) => void) | undefined;
    const first = new Promise<CourseVersion>((resolve) => { finishFirst = resolve; });
    const second = new Promise<CourseVersion>((resolve) => { finishSecond = resolve; });
    vi.mocked(catalog.version).mockReturnValueOnce(first).mockReturnValueOnce(second);
    const user = userEvent.setup();
    render(<EventWorkspaceView eventId={fictionalEvent.id} canManageCatalog setup={setup} catalog={catalog} />);
    const picker = await screen.findByLabelText('Selected round');
    await waitFor(() => { expect(catalog.version).toHaveBeenCalledTimes(2); });
    await user.selectOptions(picker, fictionalId(71));
    expect(screen.getByLabelText('Round 2 name')).toBeDisabled();
    expect(vi.mocked(catalog.version).mock.calls.every((call) => !call[2].aborted)).toBe(true);
    await act(async () => {
      if (earlier === 'first') { finishFirst?.(fictionalVersion); await first; }
      else { finishSecond?.(fictionalVersion); await second; }
    });
    expect(screen.getByRole('button', { name: 'Save event workspace' })).toBeDisabled();
    await act(async () => {
      if (earlier === 'first') { finishSecond?.(fictionalVersion); await second; }
      else { finishFirst?.(fictionalVersion); await first; }
    });
    await waitFor(() => { expect(screen.getByLabelText('Round 2 name')).toBeEnabled(); });
    await user.type(screen.getByLabelText('Round 2 name'), ' updated');
    await user.type(screen.getByLabelText('Find courses for round 2'), 'unmatched search');
    await user.selectOptions(picker, fictionalId(70));
    await user.type(screen.getByLabelText('Round 1 name'), ' updated');
    await user.selectOptions(picker, fictionalId(71));
    expect(screen.getByLabelText('Find courses for round 2')).toHaveValue('unmatched search');
    expect(catalog.version).toHaveBeenCalledTimes(2);
    await user.click(screen.getByRole('button', { name: 'Save event workspace' }));
    await screen.findByText(/Event workspace saved/);
    expect(screen.getByText(/^Matches saved setup\./)).toBeVisible();
    expect(vi.mocked(setup.save).mock.calls[0]?.[2].rounds.map((round) => round.name)).toEqual([
      'Fictional opening round updated', 'Fictional second round updated',
    ]);
    await user.type(screen.getByLabelText('Round 2 name'), ' new draft');
    expect(screen.getByRole('status')).toHaveTextContent('Unsaved changes across this event');
    expect(screen.queryByText('Event workspace saved.')).not.toBeInTheDocument();
  });

  it('offers owner-only score links without catalog grants and keeps members out of scoring discovery', async () => {
    const setup = fakeSetup();
    vi.mocked(setup.load).mockResolvedValue(fictionalWorkspace);
    const catalog = fakeCatalog();
    const view = render(<EventWorkspaceView eventId={fictionalEvent.id} canManageCatalog={false} setup={setup} catalog={catalog} />);
    expect(await screen.findByRole('link', { name: /Open owner scorecards/ })).toHaveAttribute('href',
      `#events?event=${fictionalEvent.id}&round=${fictionalId(70)}`);
    expect(catalog.players).not.toHaveBeenCalled();
    view.unmount();
    vi.mocked(setup.load).mockResolvedValue({ ...fictionalWorkspace, event: { ...fictionalEvent, role: 'member' } });
    render(<EventWorkspaceView eventId={fictionalEvent.id} canManageCatalog={false} setup={setup} catalog={catalog} />);
    await screen.findByText('Fictional Meadows', { exact: false });
    expect(screen.queryByRole('link', { name: /Open owner scorecards/ })).not.toBeInTheDocument();
  });
  it('locks scored-round setup, roster and captured-index refresh, but allows event metadata and new rounds', async () => {
    const setup = fakeSetup();
    vi.mocked(setup.load).mockResolvedValue({ ...fictionalWorkspace, rounds: fictionalWorkspace.rounds.map((round) => ({ ...round, scoringStarted: true })) });
    const user = userEvent.setup();
    render(<EventWorkspaceView eventId={fictionalEvent.id} canManageCatalog setup={setup} catalog={fakeCatalog()} />);
    await openSetupSections(user);
    await screen.findByLabelText('Round 1 name');
    await waitFor(() => { expect(screen.getByRole('button', { name: 'Add Round' })).toBeEnabled(); });
    expect(screen.getByLabelText('Workspace name')).toBeEnabled();
    expect(screen.getByLabelText('General location')).toBeEnabled();
    expect(screen.getByLabelText('Round 1 name')).toBeDisabled();
    expect(screen.getByLabelText('Round 1 course')).toBeDisabled();
    expect(screen.getByLabelText('Round 1 tee profile')).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: /I confirm replacing captured setup HI/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Refresh captured setup HI for/ })).toBeDisabled();
    expect(screen.getByRole('group', { name: /Saved player roster/ })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Add Round' }));
    expect(screen.getByLabelText('Round 2 name')).toBeEnabled();
    expect(screen.getByText('This new round has no saved inputs yet.')).toBeVisible();
    await user.selectOptions(screen.getByLabelText('Selected round'), fictionalId(70));
    expect(screen.getByText(/Clearing scores cannot unlock setup/)).toBeVisible();
    expect(setup.refreshIndices).not.toHaveBeenCalled();
  });
  it('retains superseded dirty setup for read-only review when scoring starts in another tab, without blocking metadata saves', async () => {
    const setup = fakeSetup();
    const scored: EventWorkspace = {
      ...fictionalWorkspace, etag: 'workspace-v2',
      rounds: fictionalWorkspace.rounds.map((round) => ({ ...round, scoringStarted: true })),
    };
    vi.mocked(setup.load).mockResolvedValueOnce(fictionalWorkspace).mockResolvedValue(scored);
    vi.mocked(setup.save).mockImplementation((_eventId, _etag, input) => Promise.resolve({
      ...scored, event: { ...scored.event, name: input.name }, location: input.location, etag: 'workspace-v3',
    }));
    const user = userEvent.setup();
    render(<EventWorkspaceView eventId={fictionalEvent.id} canManageCatalog setup={setup} catalog={fakeCatalog()} />);
    await openSetupSections(user);
    await screen.findByLabelText('Round 1 name');
    await waitFor(() => { expect(screen.getByLabelText('Workspace name')).toBeEnabled(); });
    await user.clear(screen.getByLabelText('Workspace name'));
    await user.type(screen.getByLabelText('Workspace name'), 'Fictional updated event name');
    await user.clear(screen.getByLabelText('General location'));
    await user.type(screen.getByLabelText('General location'), 'Fictional changed location');
    await user.clear(screen.getByLabelText('Round 1 name'));
    await user.type(screen.getByLabelText('Round 1 name'), 'Unsaved fictional round name');
    await user.selectOptions(screen.getByLabelText('Round 1 tee profile'), '905');
    await user.selectOptions(screen.getByLabelText('Fictional Player 1 — round 1 group'), '2');
    const roster = within(screen.getByRole('group', { name: /Saved player roster/ }));
    await user.click(roster.getByRole('checkbox', { name: /Fictional Player 4/ }));
    expect(screen.getByRole('button', { name: 'Save event workspace' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Refresh workspace' }));
    const review = await screen.findByRole('region', { name: 'Superseded locked setup edits' });
    expect(review).toHaveTextContent('Scoring locked saved setup inputs while you were editing');
    expect(review).toHaveTextContent('Prior local round draft: Unsaved fictional round name');
    expect(review).toHaveTextContent('personal tee assignments: 0');
    expect(review).toHaveTextContent('Prior group 2: Fictional Player 1');
    expect(within(review).getByRole('heading', { name: 'Prior local roster selection' })).toBeVisible();
    expect(within(review).queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Round 1 name')).toHaveValue('Fictional opening round');
    expect(screen.getByLabelText('Round 1 name')).toBeDisabled();
    expect(screen.getByLabelText('Round 1 tee profile')).toHaveValue('901');
    expect(screen.getByRole('group', { name: 'Saved player roster (4 selected)' })).toBeDisabled();
    expect(screen.getByLabelText('Workspace name')).toHaveValue('Fictional updated event name');
    expect(screen.getByLabelText('General location')).toHaveValue('Fictional changed location');
    const save = screen.getByRole('button', { name: 'Save event workspace' });
    await waitFor(() => { expect(save).toBeEnabled(); });
    expect(screen.getByRole('status')).toHaveTextContent('superseded local roster/round edits are retained below');
    await user.click(save);
    await screen.findByText(/Event workspace saved/);
    expect(setup.save).toHaveBeenCalledWith(fictionalEvent.id, scored.etag, {
      ...fictionalSetup, allowPerGolferTees: false,
      rounds: fictionalSetup.rounds.map((round) => ({ ...round, playerTeeSelections: [] })),
      overallCompetition: null, name: 'Fictional updated event name', location: 'Fictional changed location',
    }, expect.any(AbortSignal));
    expect(screen.getByRole('region', { name: 'Superseded locked setup edits' })).toHaveTextContent('Unsaved fictional round name');
  });
  it('marks current values unavailable after catalog failure and blocks capture replacement until catalog recovery', async () => {
    const setup = fakeSetup();
    vi.mocked(setup.load).mockResolvedValue(capturedWorkspace);
    const catalog = fakeCatalog();
    vi.mocked(catalog.players).mockRejectedValueOnce(new Error('Current player catalog failed.'));
    render(<EventWorkspaceView eventId={fictionalEvent.id} canManageCatalog setup={setup} catalog={catalog} />);
    await openSetupSections();
    expect(await screen.findAllByText('Unavailable — catalog loading failed.')).toHaveLength(4);
    expect(indexRow('Fictional Player 1').getByText('10.2 — effective 2026-01-01; Fictional manual report')).toBeVisible();
    expect(screen.getByRole('checkbox', { name: /I confirm replacing captured setup HI/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Refresh captured setup HI for/ })).toBeDisabled();
    expect(setup.refreshIndices).not.toHaveBeenCalled();
  });

  it('aborts an in-flight setup-input refresh on unmount without applying a late success', async () => {
    const setup = fakeSetup();
    vi.mocked(setup.load).mockResolvedValue(capturedWorkspace);
    let finish: ((workspace: EventWorkspace) => void) | undefined;
    const response = new Promise<EventWorkspace>((resolve) => { finish = resolve; });
    vi.mocked(setup.refreshIndices).mockReturnValueOnce(response);
    const catalog = fakeCatalog();
    vi.mocked(catalog.players).mockResolvedValue({ players: currentPlayers });
    const user = userEvent.setup();
    const { unmount } = render(<EventWorkspaceView eventId={fictionalEvent.id} canManageCatalog setup={setup} catalog={catalog} />);
    await openSetupSections(user);
    const confirmation = await screen.findByRole('checkbox', { name: /I confirm replacing captured setup HI/ });
    await waitFor(() => { expect(confirmation).toBeEnabled(); });
    await user.click(confirmation);
    await user.click(screen.getByRole('button', { name: /Refresh captured setup HI for/ }));
    expect(setup.refreshIndices).toHaveBeenCalledTimes(1);
    unmount();
    expect(vi.mocked(setup.refreshIndices).mock.calls[0]?.[4].aborted).toBe(true);
    await act(async () => { finish?.(refreshedWorkspace); await response; });
    expect(setup.save).not.toHaveBeenCalled();
    expect(setup.load).toHaveBeenCalledTimes(1);
  });
  it('distinguishes captured, current, loading, unknown and unavailable indices without silently changing captures', async () => {
    const setup = fakeSetup();
    vi.mocked(setup.load).mockResolvedValue(capturedWorkspace);
    const catalog = fakeCatalog();
    let finish: ((page: PlayerCatalogPage) => void) | undefined;
    const load = new Promise<PlayerCatalogPage>((resolve) => { finish = resolve; });
    vi.mocked(catalog.players).mockReturnValueOnce(load);
    render(<EventWorkspaceView eventId={fictionalEvent.id} canManageCatalog setup={setup} catalog={catalog} />);
    await openSetupSections();
    await screen.findByText('10.2 — effective 2026-01-01; Fictional manual report');
    expect(screen.getAllByText('Loading current catalog HI...')).toHaveLength(4);
    expect(screen.getByRole('button', { name: /Refresh captured setup HI for/ })).toBeDisabled();
    await act(async () => { finish?.({ players: currentPlayers.slice(0, 3) }); await load; });
    const first = indexRow('Fictional Player 1');
    expect(first.getByText('10.2 — effective 2026-01-01; Fictional manual report')).toBeVisible();
    expect(first.getByText('+1.2 — effective 2026-02-01; Fictional manual report')).toBeVisible();
    expect(first.getByText(/Changed since capture/)).toBeVisible();
    expect(indexRow('Fictional Player 2').getAllByText('Unknown — no handicap observation')).toHaveLength(2);
    expect(indexRow('Fictional Player 4').getByText(/Unavailable — player not found/)).toBeVisible();
    expect(screen.getByRole('checkbox', { name: /I confirm replacing captured setup HI/ })).toBeDisabled();
    expect(setup.refreshIndices).not.toHaveBeenCalled();
  });

  it('reloads catalog values with scoped workspace refresh while preserving local name, course, tee and group drafts', async () => {
    const setup = fakeSetup();
    vi.mocked(setup.load).mockResolvedValue(capturedWorkspace);
    const catalog = fakeCatalog();
    vi.mocked(catalog.players).mockResolvedValueOnce({ players: fictionalPlayers.map((player, index) => ({ ...player, currentIndex: index === 0 ? oldIndex : null })) });
    const user = userEvent.setup();
    render(<EventWorkspaceView eventId={fictionalEvent.id} canManageCatalog setup={setup} catalog={catalog} />);
    await openSetupSections(user);
    const name = await screen.findByLabelText('Workspace name');
    await waitFor(() => { expect(name).toBeEnabled(); });
    await user.clear(name);
    await user.type(name, 'Fictional unsaved workspace title');
    await user.selectOptions(screen.getByLabelText('Round 1 tee profile'), '905');
    await user.selectOptions(screen.getByLabelText('Fictional Player 1 — round 1 group'), '2');
    let finish: ((page: PlayerCatalogPage) => void) | undefined;
    const load = new Promise<PlayerCatalogPage>((resolve) => { finish = resolve; });
    vi.mocked(catalog.players).mockReturnValueOnce(load);
    await user.dblClick(screen.getByRole('button', { name: 'Refresh workspace' }));
    await waitFor(() => { expect(catalog.players).toHaveBeenCalledTimes(2); });
    expect(name).toBeDisabled();
    expect(screen.getByRole('button', { name: /Refresh captured setup HI for/ })).toBeDisabled();
    expect(setup.load).toHaveBeenCalledTimes(2);
    await act(async () => { finish?.({ players: currentPlayers }); await load; });
    await screen.findByText(/Workspace refreshed. Your local draft is preserved/);
    expect(name).toHaveValue('Fictional unsaved workspace title');
    expect(screen.getByLabelText('Round 1 course')).toHaveValue(fictionalVersion.courseId);
    expect(screen.getByLabelText('Round 1 course version')).toHaveValue(fictionalVersion.id);
    expect(screen.getByLabelText('Round 1 tee profile')).toHaveValue('905');
    expect(screen.getByLabelText('Fictional Player 1 — round 1 group')).toHaveValue('2');
    expect(indexRow('Fictional Player 1').getByText('10.2 — effective 2026-01-01; Fictional manual report')).toBeVisible();
    expect(indexRow('Fictional Player 1').getByText('+1.2 — effective 2026-02-01; Fictional manual report')).toBeVisible();
    expect(setup.save).not.toHaveBeenCalled();
    expect(setup.refreshIndices).not.toHaveBeenCalled();
  });

  it('requires explicit capture replacement, retries an uncertain refresh with the original ID/revision, and preserves unsaved drafts', async () => {
    const setup = fakeSetup();
    vi.mocked(setup.load).mockResolvedValue(capturedWorkspace);
    let finish: ((workspace: EventWorkspace) => void) | undefined;
    const refresh = new Promise<EventWorkspace>((resolve) => { finish = resolve; });
    vi.mocked(setup.refreshIndices).mockRejectedValueOnce(new Error('Setup refresh response lost.')).mockReturnValueOnce(refresh);
    const catalog = fakeCatalog();
    vi.mocked(catalog.players).mockResolvedValue({ players: currentPlayers });
    const user = userEvent.setup();
    render(<EventWorkspaceView eventId={fictionalEvent.id} canManageCatalog setup={setup} catalog={catalog} />);
    await openSetupSections(user);
    const name = await screen.findByLabelText('Workspace name');
    await waitFor(() => { expect(name).toBeEnabled(); });
    await user.clear(name);
    await user.type(name, 'Fictional draft title');
    await user.selectOptions(screen.getByLabelText('Round 1 tee profile'), '905');
    await user.selectOptions(screen.getByLabelText('Fictional Player 1 — round 1 group'), '2');
    const button = screen.getByRole('button', { name: 'Refresh captured setup HI for Fictional opening round' });
    const confirmation = screen.getByRole('checkbox', { name: /I confirm replacing captured setup HI/ });
    expect(button).toBeDisabled();
    await user.click(confirmation);
    await user.click(button);
    await screen.findByText('Setup refresh response lost.');
    expect(confirmation).toBeChecked();
    expect(name).toHaveValue('Fictional draft title');
    await user.dblClick(button);
    expect(setup.refreshIndices).toHaveBeenCalledTimes(2);
    expect(name).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save event workspace' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Refresh workspace' })).toBeDisabled();
    const calls = vi.mocked(setup.refreshIndices).mock.calls;
    expect(calls[0]?.slice(0, 4)).toEqual(calls[1]?.slice(0, 4));
    expect(calls[0]?.[2]).toBe(capturedWorkspace.etag);
    await act(async () => { finish?.(refreshedWorkspace); await refresh; });
    await screen.findByText('Captured setup HI refreshed for Fictional opening round. Saved course, tee and groups were preserved. No scores were recalculated.');
    expect(confirmation).not.toBeChecked();
    expect(button).toBeDisabled();
    expect(name).toHaveValue('Fictional draft title');
    expect(screen.getByLabelText('Round 1 tee profile')).toHaveValue('905');
    expect(screen.getByLabelText('Fictional Player 1 — round 1 group')).toHaveValue('2');
    expect(indexRow('Fictional Player 1').getAllByText('+1.2 — effective 2026-02-01; Fictional manual report')).toHaveLength(2);
    expect(screen.getByText('Group 1: Fictional Player 1, Fictional Player 2, Fictional Player 3, Fictional Player 4')).toBeVisible();
    expect(screen.getByText('Tee: Fictional Teal / Fictional A / 9 holes')).toBeVisible();
    expect(setup.save).not.toHaveBeenCalled();
  });

  it('requires scoped refresh and renewed review after a capture-refresh conflict', async () => {
    const setup = fakeSetup();
    vi.mocked(setup.load).mockResolvedValue(capturedWorkspace);
    vi.mocked(setup.refreshIndices).mockRejectedValueOnce(new EventChangedError('Workspace changed. Refresh and review captured inputs.'))
      .mockResolvedValueOnce(refreshedWorkspace);
    const catalog = fakeCatalog();
    vi.mocked(catalog.players).mockResolvedValue({ players: currentPlayers });
    const user = userEvent.setup();
    render(<EventWorkspaceView eventId={fictionalEvent.id} canManageCatalog setup={setup} catalog={catalog} />);
    await openSetupSections(user);
    const name = await screen.findByLabelText('Workspace name');
    await waitFor(() => { expect(name).toBeEnabled(); });
    await user.clear(name);
    await user.type(name, 'Fictional conflict draft');
    await user.click(screen.getByRole('checkbox', { name: /I confirm replacing captured setup HI/ }));
    await user.click(screen.getByRole('button', { name: /Refresh captured setup HI for/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Workspace changed');
    expect(screen.getByRole('checkbox', { name: /I confirm replacing captured setup HI/ })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: /I confirm replacing captured setup HI/ })).toBeDisabled();
    vi.mocked(setup.load).mockResolvedValue({ ...capturedWorkspace, event: { ...fictionalEvent, etag: 'workspace-v2' }, etag: 'workspace-v2' });
    await user.click(screen.getByRole('button', { name: 'Refresh workspace' }));
    await screen.findByText(/Workspace refreshed. Your local draft is preserved/);
    expect(name).toHaveValue('Fictional conflict draft');
    const confirmation = screen.getByRole('checkbox', { name: /I confirm replacing captured setup HI/ });
    expect(confirmation).not.toBeChecked();
    await user.click(confirmation);
    await user.click(screen.getByRole('button', { name: /Refresh captured setup HI for/ }));
    await screen.findByText(/Captured setup HI refreshed for/);
    const calls = vi.mocked(setup.refreshIndices).mock.calls;
    expect(calls[1]?.[2]).toBe('workspace-v2');
    expect(calls[1]?.[3]).not.toBe(calls[0]?.[3]);
    expect(name).toHaveValue('Fictional conflict draft');
  });
  it('prevents refresh while the initial workspace is pending and never lets it overwrite a newer refresh', async () => {
    const catalog = fakeCatalog();
    const setup = fakeSetup();
    let finish: ((workspace: EventWorkspace) => void) | undefined;
    const initial = new Promise<EventWorkspace>((resolve) => { finish = resolve; });
    vi.mocked(setup.load).mockReturnValueOnce(initial)
      .mockResolvedValue({ ...fictionalWorkspace, event: { ...fictionalEvent, name: 'Fictional refreshed title', etag: 'workspace-v2' }, etag: 'workspace-v2' });
    const user = userEvent.setup();
    render(<EventWorkspaceView eventId={fictionalEvent.id} canManageCatalog setup={setup} catalog={catalog} />);
    const refresh = screen.getByRole('button', { name: 'Refresh workspace' });
    expect(refresh).toBeDisabled();
    await user.click(refresh);
    expect(setup.load).toHaveBeenCalledTimes(1);
    expect(setup.save).not.toHaveBeenCalled();
    await act(async () => { finish?.(fictionalWorkspace); await initial; });
    await waitFor(() => { expect(refresh).toBeEnabled(); });
    await user.click(refresh);
    expect(await screen.findByRole('heading', { name: 'Fictional refreshed title' })).toBeVisible();
    expect(setup.load).toHaveBeenCalledTimes(2);
    expect(screen.getByLabelText('Workspace name')).toHaveValue(fictionalEvent.name);
  });

  it('allows workspace refresh after an initial load failure settles', async () => {
    const catalog = fakeCatalog();
    const setup = fakeSetup();
    let reject: ((reason: Error) => void) | undefined;
    const initial = new Promise<EventWorkspace>((_resolve, fail) => { reject = fail; });
    vi.mocked(setup.load).mockReturnValueOnce(initial);
    const user = userEvent.setup();
    render(<EventWorkspaceView eventId={fictionalEvent.id} canManageCatalog setup={setup} catalog={catalog} />);
    await act(async () => { reject?.(new Error('Initial workspace unavailable.')); await initial.catch(() => undefined); });
    expect(await screen.findByRole('alert')).toHaveTextContent('Initial workspace unavailable');
    expect(screen.getByRole('button', { name: 'Refresh workspace' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Refresh workspace' }));
    await openSetupSections(user);
    expect(await screen.findByLabelText('Workspace name')).toBeVisible();
    expect(setup.load).toHaveBeenCalledTimes(2);
  });

  it('retries failed catalog selections once per explicit request while preserving the local workspace draft', async () => {
    const setup = fakeSetup();
    vi.mocked(setup.load).mockResolvedValue(fictionalWorkspace);
    const original = fakeCatalog();
    const replacement = fakeCatalog();
    let finish: ((page: CourseCatalogPage) => void) | undefined;
    const retry = new Promise<CourseCatalogPage>((resolve) => { finish = resolve; });
    vi.mocked(replacement.courses).mockRejectedValueOnce(new Error('Catalog selections unavailable.')).mockReturnValueOnce(retry);
    const user = userEvent.setup();
    const { rerender } = render(<EventWorkspaceView eventId={fictionalEvent.id} canManageCatalog setup={setup} catalog={original} />);
    await openSetupSections(user);
    const name = await screen.findByLabelText('Workspace name');
    await waitFor(() => { expect(name).toBeEnabled(); });
    await user.clear(name);
    await user.type(name, 'Fictional preserved local title');
    const savedRoundName = screen.getByLabelText('Round 1 name');
    await user.clear(savedRoundName);
    await user.type(savedRoundName, 'Fictional preserved local round');
    rerender(<EventWorkspaceView eventId={fictionalEvent.id} canManageCatalog setup={setup} catalog={replacement} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Catalog selections unavailable');
    expect(name).toHaveValue('Fictional preserved local title');
    expect(savedRoundName).toHaveValue('Fictional preserved local round');
    expect(screen.getByRole('button', { name: 'Save event workspace' })).toBeDisabled();
    expect(replacement.courses).toHaveBeenCalledTimes(1);
    await user.dblClick(screen.getByRole('button', { name: 'Retry catalog selections' }));
    await screen.findByText('Loading saved catalog selections...');
    expect(replacement.courses).toHaveBeenCalledTimes(2);
    expect(name).toBeDisabled();
    await act(async () => { finish?.({ courses: [fictionalEntry] }); await retry; });
    await waitFor(() => { expect(name).toBeEnabled(); });
    expect(name).toHaveValue('Fictional preserved local title');
    expect(savedRoundName).toHaveValue('Fictional preserved local round');
    expect(setup.load).toHaveBeenCalledTimes(1);
    expect(setup.save).not.toHaveBeenCalled();
  });
  it('leaves roster additions unassigned, permits more than eight, and prevents adding a fifth player to a group', async () => {
    const catalog = fakeCatalog();
    const setup = fakeSetup();
    const players = Array.from({ length: 9 }, (_, i) => ({
      id: fictionalId(i + 1), displayName: `Fictional Player ${String(i + 1)}`,
      currentIndex: null, etag: 'player-v1', createdAt: '2026-01-01',
    }));
    vi.mocked(catalog.players).mockResolvedValue({ players });
    const user = userEvent.setup();
    render(<EventWorkspaceView eventId={fictionalEvent.id} canManageCatalog setup={setup} catalog={catalog} />);
    for (const player of players.slice(0, 8)) await user.click(await screen.findByLabelText(`${player.displayName} — HI Unknown`));
    expect(screen.getByLabelText('Fictional Player 9 — HI Unknown')).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Add Round' }));
    await user.type(screen.getByLabelText('Round 1 name'), 'Fictional round');
    await user.selectOptions(screen.getByLabelText('Round 1 course'), fictionalVersion.courseId);
    await user.selectOptions(screen.getByLabelText('Round 1 course version'), fictionalVersion.id);
    await waitFor(() => { expect(screen.getByLabelText('Round 1 tee profile')).toBeEnabled(); });
    await user.selectOptions(screen.getByLabelText('Round 1 tee profile'), '901');
    for (const [index, player] of players.slice(0, 8).entries()) {
      const group = screen.getByLabelText(`${player.displayName} — round 1 group`);
      expect(group).toHaveValue('');
      if (index === 4) {
        expect(within(group).getByRole('option', { name: 'Group 1 (4/4, full)' })).toBeDisabled();
        await user.selectOptions(group, '1');
        expect(group).toHaveValue('');
      } else await user.selectOptions(group, index < 4 ? '1' : '2');
    }
    expect(screen.getByRole('button', { name: 'Save event workspace' })).toBeDisabled();
    await user.selectOptions(screen.getByLabelText('Fictional Player 5 — round 1 group'), '2');
    expect(screen.getByRole('button', { name: 'Save event workspace' })).toBeEnabled();
    await user.click(screen.getByLabelText('Fictional Player 8 — HI Unknown'));
    await user.click(screen.getByLabelText('Fictional Player 8 — HI Unknown'));
    expect(screen.getByLabelText('Fictional Player 8 — round 1 group')).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Save event workspace' })).toBeDisabled();
  });

  it('surfaces a version-load failure without selecting a tee and allows an explicit retry', async () => {
    const catalog = fakeCatalog();
    vi.mocked(catalog.version).mockRejectedValueOnce(new Error('Selected course version unavailable.'));
    const setup = fakeSetup();
    const user = userEvent.setup();
    render(<EventWorkspaceView eventId={fictionalEvent.id} canManageCatalog setup={setup} catalog={catalog} />);
    await waitFor(() => { expect(screen.getByRole('button', { name: 'Add Round' })).toBeEnabled(); });
    await user.click(screen.getByRole('button', { name: 'Add Round' }));
    await user.selectOptions(screen.getByLabelText('Round 1 course'), fictionalVersion.courseId);
    await user.selectOptions(screen.getByLabelText('Round 1 course version'), fictionalVersion.id);
    expect(await screen.findByRole('alert')).toHaveTextContent('Selected course version unavailable');
    expect(screen.getByLabelText('Round 1 tee profile')).toHaveValue('');
    expect(screen.getByLabelText('Round 1 tee profile')).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Retry round 1 version' }));
    await waitFor(() => { expect(screen.getByLabelText('Round 1 tee profile')).toBeEnabled(); });
    expect(screen.getByLabelText('Round 1 tee profile')).toHaveValue('');
    expect(catalog.version).toHaveBeenCalledTimes(2);
  });
  it('requires saved-player roster, explicit version and category, manual groups, and supports multiple rounds', async () => {
    const catalog = fakeCatalog();
    const setup = fakeSetup();
    vi.mocked(setup.save).mockImplementation((_id, _etag, input) => Promise.resolve(savedInput(input)));
    const user = userEvent.setup();
    render(<EventWorkspaceView eventId={fictionalEvent.id} canManageCatalog setup={setup} catalog={catalog} />);
    await screen.findByText('No saved rounds.');
    const save = screen.getByRole('button', { name: 'Save event workspace' });
    expect(save).toBeDisabled();
    for (const player of fictionalPlayers) await user.click(await screen.findByLabelText(`${player.displayName} — HI Unknown`));
    await user.type(screen.getByLabelText('General location'), 'Fictional County');
    await user.click(screen.getByRole('button', { name: 'Add Round' }));
    await configureRound(user, 1);
    expect(save).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Add Round' }));
    expect(save).toBeDisabled();
    await configureRound(user, 2);
    await user.click(save);
    await screen.findByText(/Event workspace saved/);
    const input = vi.mocked(setup.save).mock.calls[0]?.[2];
    expect(input?.rounds).toHaveLength(2);
    expect(input?.playerIds).toEqual(fictionalPlayers.map((player) => player.id));
    expect(input?.rounds[0]).toMatchObject({
      courseId: fictionalVersion.courseId, courseVersionId: fictionalVersion.id, teeProfileId: 905,
      groups: fictionalPlayers.map((player, index) => ({ number: index + 1, playerIds: [player.id] })),
    });
    expect(screen.getAllByText(/Immutable saved course version/)).toHaveLength(2);
    expect(screen.getAllByText(/Tee: Fictional Teal \/ Fictional B/)).toHaveLength(2);
    expect(screen.queryByRole('button', { name: /delete|remove round/i })).not.toBeInTheDocument();
  });

  it.each([
    ['member', 'active', true], ['owner', 'active', false], ['owner', 'archived', true],
  ] as const)('uses only event-local read-only projections for %s/%s with manager=%s', async (role, status, manager) => {
    const catalog = fakeCatalog();
    const setup = fakeSetup();
    const workspace: EventWorkspace = {
      ...fictionalWorkspace, event: { ...fictionalEvent, role, status },
      rounds: fictionalWorkspace.rounds.map((round) => ({ ...round,
        players: round.players.map((player) => ({ playerId: player.playerId, displayName: player.displayName })),
      })),
    };
    vi.mocked(setup.load).mockResolvedValue(workspace);
    render(<EventWorkspaceView eventId={fictionalEvent.id} canManageCatalog={manager} setup={setup} catalog={catalog} />);
    await screen.findByText(/Tee: Fictional Teal/);
    expect(screen.queryByLabelText('Workspace name')).not.toBeInTheDocument();
    expect(catalog.courses).not.toHaveBeenCalled();
    expect(catalog.players).not.toHaveBeenCalled();
    expect(catalog.version).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Save event workspace' })).not.toBeInTheDocument();
    expect(screen.queryByText('Current catalog HI')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Refresh captured setup HI for/ })).not.toBeInTheDocument();
    if (role === 'member') expect(screen.queryByText(/captured HI/)).not.toBeInTheDocument();
  });

  it('preserves local input and saved rounds across conflicts, requires refresh, and uses the refreshed revision', async () => {
    const catalog = fakeCatalog();
    const setup = fakeSetup();
    vi.mocked(setup.load).mockResolvedValue(fictionalWorkspace);
    vi.mocked(setup.save).mockRejectedValueOnce(new EventChangedError('Workspace changed. Refresh first.'));
    const user = userEvent.setup();
    render(<EventWorkspaceView eventId={fictionalEvent.id} canManageCatalog setup={setup} catalog={catalog} />);
    await openSetupSections(user);
    const name = await screen.findByLabelText('Workspace name');
    await waitFor(() => { expect(name).toBeEnabled(); });
    await user.clear(name);
    await user.type(name, 'Fictional revised title');
    await user.click(screen.getByRole('button', { name: 'Save event workspace' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Refresh first');
    expect(name).toHaveValue('Fictional revised title');
    await user.type(screen.getByLabelText('General location'), ' updated');
    expect(screen.getByRole('alert')).toHaveTextContent('Refresh first');
    expect(screen.getByRole('button', { name: 'Save event workspace' })).toBeDisabled();
    vi.mocked(setup.load).mockResolvedValue({ ...fictionalWorkspace, event: { ...fictionalEvent, etag: 'workspace-v2' }, etag: 'workspace-v2' });
    await user.click(screen.getByRole('button', { name: 'Refresh workspace' }));
    await screen.findByText(/Workspace refreshed/);
    expect(name).toHaveValue('Fictional revised title');
    await user.click(screen.getByRole('button', { name: 'Save event workspace' }));
    await waitFor(() => { expect(setup.save).toHaveBeenCalledTimes(2); });
    expect(vi.mocked(setup.save).mock.calls[1]?.[1]).toBe('workspace-v2');
    expect(vi.mocked(setup.save).mock.calls[1]?.[2].rounds[0]?.id).toBe(fictionalWorkspace.rounds[0]?.id);
  });

  it('blocks overlapping saves and retains draft through a failed write', async () => {
    const catalog = fakeCatalog();
    const setup = fakeSetup();
    vi.mocked(setup.load).mockResolvedValue(fictionalWorkspace);
    let reject: ((reason: Error) => void) | undefined;
    const response = new Promise<EventWorkspace>((_resolve, fail) => { reject = fail; });
    vi.mocked(setup.save).mockReturnValueOnce(response);
    const user = userEvent.setup();
    render(<EventWorkspaceView eventId={fictionalEvent.id} canManageCatalog setup={setup} catalog={catalog} />);
    await openSetupSections(user);
    const name = await screen.findByLabelText('Workspace name');
    await waitFor(() => { expect(name).toBeEnabled(); });
    await user.dblClick(screen.getByRole('button', { name: 'Save event workspace' }));
    expect(setup.save).toHaveBeenCalledTimes(1);
    expect(name).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Refresh workspace' })).toBeDisabled();
    await act(async () => { reject?.(new Error('Write failed; nothing was confirmed saved.')); await response.catch(() => undefined); });
    expect(await screen.findByText('Write failed; nothing was confirmed saved.')).toBeVisible();
    expect(name).toHaveValue(fictionalEvent.name);
    expect(name).toBeEnabled();
  });

  it('does not save while a selected version is pending and aborts late version loads on unmount', async () => {
    const catalog = fakeCatalog();
    const setup = fakeSetup();
    let finish: ((version: CourseVersion) => void) | undefined;
    const response = new Promise<CourseVersion>((resolve) => { finish = resolve; });
    vi.mocked(catalog.version).mockReturnValue(response);
    const user = userEvent.setup();
    const { unmount } = render(<EventWorkspaceView eventId={fictionalEvent.id} canManageCatalog setup={setup} catalog={catalog} />);
    await openSetupSections(user);
    await screen.findByLabelText('Workspace name');
    await waitFor(() => { expect(screen.getByRole('button', { name: 'Add Round' })).toBeEnabled(); });
    await user.click(screen.getByRole('button', { name: 'Add Round' }));
    await user.selectOptions(screen.getByLabelText('Round 1 course'), fictionalVersion.courseId);
    await user.selectOptions(screen.getByLabelText('Round 1 course version'), fictionalVersion.id);
    expect(screen.getByRole('button', { name: 'Save event workspace' })).toBeDisabled();
    expect(screen.getByLabelText('Workspace name')).toBeDisabled();
    unmount();
    expect(vi.mocked(catalog.version).mock.calls[0]?.[2].aborted).toBe(true);
    await act(async () => { finish?.(fictionalVersion); await response; });
    expect(setup.save).not.toHaveBeenCalled();
    expect(emptyWorkspace.rounds).toHaveLength(0);
  });
});
