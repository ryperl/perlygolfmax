import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { EventChangedError } from '../../client/events';
import {
  emptyWorkspace, fakeCatalog, fakeSetup, fictionalEvent, fictionalPlayers, fictionalManifest,
  fictionalProfile, fictionalVersion, fictionalWorkspace, fictionalId, fictionalEntry,
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
    rounds: input.rounds.map((round) => ({
      id: round.id, name: round.name, courseId: round.courseId, courseVersionId: round.courseVersionId,
      teeProfile: fictionalVersion.data.teeProfiles.find((profile) => profile.id === round.teeProfileId) ?? fictionalProfile,
      course: fictionalManifest.course, groups: round.groups,
      players: fictionalPlayers.map((player) => ({ playerId: player.id, displayName: player.displayName, handicapIndex: null })),
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

describe('saved event workspace', () => {
  it('marks current values unavailable after catalog failure and blocks capture replacement until catalog recovery', async () => {
    const setup = fakeSetup();
    vi.mocked(setup.load).mockResolvedValue(capturedWorkspace);
    const catalog = fakeCatalog();
    vi.mocked(catalog.players).mockRejectedValueOnce(new Error('Current player catalog failed.'));
    render(<EventWorkspaceView eventId={fictionalEvent.id} canManageCatalog setup={setup} catalog={catalog} />);
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
  it('leaves roster additions unassigned, bounds roster at eight, and rejects more than four players per manual group', async () => {
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
    expect(screen.getByLabelText('Fictional Player 9 — HI Unknown')).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Add Round' }));
    await user.type(screen.getByLabelText('Round 1 name'), 'Fictional round');
    await user.selectOptions(screen.getByLabelText('Round 1 course'), fictionalVersion.courseId);
    await user.selectOptions(screen.getByLabelText('Round 1 course version'), fictionalVersion.id);
    await waitFor(() => { expect(screen.getByLabelText('Round 1 tee profile')).toBeEnabled(); });
    await user.selectOptions(screen.getByLabelText('Round 1 tee profile'), '901');
    for (const [index, player] of players.slice(0, 8).entries()) {
      const group = screen.getByLabelText(`${player.displayName} — round 1 group`);
      expect(group).toHaveValue('');
      await user.selectOptions(group, index < 5 ? '1' : '2');
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
    expect(screen.getAllByText(/Saved course version:/)).toHaveLength(2);
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
    const name = await screen.findByLabelText('Workspace name');
    await waitFor(() => { expect(name).toBeEnabled(); });
    await user.clear(name);
    await user.type(name, 'Fictional revised title');
    await user.click(screen.getByRole('button', { name: 'Save event workspace' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Refresh first');
    expect(name).toHaveValue('Fictional revised title');
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
