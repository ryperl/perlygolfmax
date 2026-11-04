import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { EventChangedError } from '../../client/events';
import {
  emptyWorkspace, fakeCatalog, fakeSetup, fictionalEvent, fictionalPlayers, fictionalManifest,
  fictionalProfile, fictionalVersion, fictionalWorkspace, fictionalId, fictionalEntry,
} from '../../client/catalog.test-support';
import type { CourseCatalogPage, CourseVersion } from '../../domain/catalog';
import type { EventSetupInput, EventWorkspace } from '../../domain/setup';
import { EventWorkspaceView } from './EventWorkspaceView';

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
    await user.click(screen.getByRole('button', { name: 'Add another round' }));
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
    await waitFor(() => { expect(screen.getByRole('button', { name: 'Add another round' })).toBeEnabled(); });
    await user.click(screen.getByRole('button', { name: 'Add another round' }));
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
    await user.click(screen.getByRole('button', { name: 'Add another round' }));
    await configureRound(user, 1);
    expect(save).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Add another round' }));
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
    await waitFor(() => { expect(screen.getByRole('button', { name: 'Add another round' })).toBeEnabled(); });
    await user.click(screen.getByRole('button', { name: 'Add another round' }));
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
