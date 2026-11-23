import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { QuickPage, QuickPlayer } from '../../domain/quick-round';
import { fictionalCourse, fictionalId, fictionalVersion } from '../../client/catalog.test-support';
import { EventChangedError } from '../../client/events';
import { gameResult } from '../../client/scoring.test-support';
import { stablefordPoints } from '../../domain/stableford';
import { QuickRoundView } from './QuickRoundView';
import { quickSource, quickWorkspace } from './quick-round.test-support';

beforeEach(() => { window.history.replaceState(null, '', '#events?quick=1'); });

async function choose() {
  const course = await screen.findByRole('combobox', { name: 'Course' });
  fireEvent.change(screen.getByLabelText('Round / event name'), { target: { value: 'Fictional Quick outing' } });
  fireEvent.change(course, { target: { value: fictionalVersion.courseId } });
  await screen.findByRole('option', { name: 'Fictional Teal / Fictional A / 9 holes' });
  fireEvent.change(screen.getByLabelText('Default tee'), { target: { value: '901' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add golfers' }));
  fireEvent.click(screen.getByLabelText('Fictional Player 1', { exact: true }));
}

async function showGames() {
  const add = await screen.findByRole('button', { name: 'Add games' });
  await waitFor(() => { expect(add).toBeEnabled(); });
  fireEvent.click(add);
  return screen.findByRole('form', { name: 'Game settings' });
}

describe('public Quick round controller', () => {
  it('keeps an uncertain shared-player attempt retryable across missing captured inputs and failed lock recovery', async () => {
    const source = quickSource();
    const page = await source.client.players(new AbortController().signal);
    vi.mocked(source.client.players).mockResolvedValue({ ...page, publicPlayerCreation: true });
    vi.mocked(source.client.load).mockResolvedValueOnce(source.workspace).mockRejectedValueOnce(new Error('Fictional capture recovery failed'));
    const read = vi.mocked(source.scores.load).getMockImplementation();
    if (!read) throw new Error('Missing fictional score reader');
    let resolveScores: (() => void) | undefined;
    vi.mocked(source.scores.load).mockImplementationOnce(async (...args) => {
      const value = await read(...args);
      return new Promise((resolve) => { resolveScores = () => { resolve({ ...value, setupLocked: true }); }; });
    });
    const player = { id: fictionalId(992), displayName: 'Fictional Capture Gap Newcomer', handicapIndexValue: '0' };
    let rejectPlayer: (() => void) | undefined;
    const createPlayer = vi.fn().mockImplementationOnce((_input, _id, signal: AbortSignal) => new Promise((_resolve, reject) => {
      rejectPlayer = () => { expect(signal.aborted).toBe(false); reject(new Error('Fictional lost creation acknowledgement')); };
    })).mockResolvedValueOnce(player);
    render(<QuickRoundView client={{ ...source.client, createPlayer }} scores={source.scores} eventId={source.workspace.event.id} />);
    await screen.findByRole('button', { name: 'New player' });
    fireEvent.click(screen.getByRole('button', { name: 'New player' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: player.displayName } });
    fireEvent.change(screen.getByLabelText('GHIN Handicap Index (as entered)'), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create player' }));
    await waitFor(() => { expect(resolveScores).toBeDefined(); expect(rejectPlayer).toBeDefined(); });
    await act(() => Promise.resolve(resolveScores?.()));
    await screen.findByText(/Fictional capture recovery failed/);
    expect(screen.getByRole('dialog')).toBeVisible();
    expect(screen.queryByRole('region', { name: 'Round golfers' })).not.toBeInTheDocument();
    await act(() => Promise.resolve(rejectPlayer?.()));
    expect(screen.getByLabelText('Name')).toHaveValue(player.displayName);
    expect(screen.getByLabelText('GHIN Handicap Index (as entered)')).toHaveValue('0');
    const retry = screen.getByRole('button', { name: 'Retry player creation' });
    expect(retry).toBeEnabled();
    fireEvent.click(retry);
    await screen.findByText(/Player created.*roster.*locked/);
    expect(createPlayer.mock.calls[1]?.[1]).toBe(createPlayer.mock.calls[0]?.[1]);
    expect(createPlayer.mock.calls[1]?.[0]).toEqual(createPlayer.mock.calls[0]?.[0]);
    expect(source.client.create).not.toHaveBeenCalled();
    expect(source.client.save).not.toHaveBeenCalled();
  });
  it('retains an in-flight shared-player creation when saved scoring locks the round', async () => {
    const source = quickSource();
    const page = await source.client.players(new AbortController().signal);
    vi.mocked(source.client.players).mockResolvedValue({ ...page, publicPlayerCreation: true });
    const read = vi.mocked(source.scores.load).getMockImplementation();
    if (!read) throw new Error('Missing fictional score reader');
    let resolveScores: (() => void) | undefined;
    vi.mocked(source.scores.load).mockImplementationOnce(async (...args) => {
      const value = await read(...args);
      return new Promise((resolve) => { resolveScores = () => { resolve({ ...value, setupLocked: true,
        courseHandicaps: value.cards.map((card) => ({ playerId: card.playerId, courseHandicap: 8 })) }); }; });
    });
    const player = { id: fictionalId(991), displayName: 'Fictional Independent Newcomer', handicapIndexValue: '5.0' };
    let resolvePlayer: (() => void) | undefined;
    const createPlayer = vi.fn().mockImplementation((_input, _id, signal: AbortSignal) => new Promise((resolve) => {
      resolvePlayer = () => { expect(signal.aborted).toBe(false); resolve(player); };
    }));
    render(<QuickRoundView client={{ ...source.client, createPlayer }} scores={source.scores} eventId={source.workspace.event.id} />);
    await screen.findByRole('button', { name: 'New player' });
    fireEvent.click(screen.getByRole('button', { name: 'New player' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: player.displayName } });
    fireEvent.change(screen.getByLabelText('GHIN Handicap Index (as entered)'), { target: { value: player.handicapIndexValue } });
    fireEvent.click(screen.getByRole('button', { name: 'Create player' }));
    await waitFor(() => { expect(resolveScores).toBeDefined(); expect(resolvePlayer).toBeDefined(); });
    await act(() => Promise.resolve(resolveScores?.()));
    expect(screen.getByRole('dialog')).toBeVisible();
    expect(screen.getByLabelText('Name')).toHaveValue(player.displayName);
    await act(() => Promise.resolve(resolvePlayer?.()));
    expect(await screen.findByText(/Player created.*roster.*locked/)).toBeVisible();
    expect(source.client.save).not.toHaveBeenCalled();
    expect(source.client.create).not.toHaveBeenCalled();
  });
  it('selects a newly created shared player in the draft and never repeats creation after an uncertain round save', async () => {
    const source = quickSource();
    const page = await source.client.players(new AbortController().signal);
    vi.mocked(source.client.players).mockResolvedValue({ ...page, publicPlayerCreation: true });
    const player = { id: fictionalId(990), displayName: 'Fictional Shared Newcomer', handicapIndexValue: '+1' };
    const createPlayer = vi.fn().mockResolvedValue(player);
    vi.mocked(source.client.create).mockRejectedValueOnce(new Error('Fictional lost round acknowledgement'));
    render(<QuickRoundView client={{ ...source.client, createPlayer }} scores={source.scores} />);
    await choose();
    fireEvent.click(screen.getByRole('button', { name: 'New player' }));
    expect(screen.getByRole('button', { name: 'Open full setup' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: player.displayName } });
    fireEvent.change(screen.getByLabelText('GHIN Handicap Index (as entered)'), { target: { value: '+1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create player' }));
    await screen.findByText('Player created and selected. Round setup is not saved yet.');
    expect(screen.getByLabelText(player.displayName, { exact: true })).toBeChecked();
    expect(source.client.create).not.toHaveBeenCalled();
    await waitFor(() => { expect(screen.getByRole('button', { name: 'Start scoring' })).toBeEnabled(); });
    fireEvent.click(screen.getByRole('button', { name: 'Start scoring' }));
    await screen.findByRole('button', { name: 'Retry Start scoring' });
    expect(vi.mocked(source.client.create).mock.calls[0]?.[1].playerIds).toContain(player.id);
    fireEvent.click(screen.getByRole('button', { name: 'Retry Start scoring' }));
    await waitFor(() => { expect(source.client.create).toHaveBeenCalledTimes(2); });
    expect(createPlayer).toHaveBeenCalledOnce();
    expect(vi.mocked(source.client.create).mock.calls[1]?.[1]).toEqual(vi.mocked(source.client.create).mock.calls[0]?.[1]);
  });

  it('does not expose public creation for an older directory capability response', async () => {
    const source = quickSource();
    render(<QuickRoundView client={{ ...source.client, createPlayer: vi.fn() }} scores={source.scores} />);
    await choose();
    expect(screen.queryByRole('button', { name: 'New player' })).not.toBeInTheDocument();
  });
  it('saves the shared start before games and preserves an explicit SO choice without another setup or score write', async () => {
    const source = quickSource(true);
    render(<QuickRoundView client={source.client} scores={source.scores} />);
    await choose();
    for (const number of [2, 3, 4]) fireEvent.click(screen.getByLabelText(`Fictional Player ${String(number)}`, { exact: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit Group 1' }));
    fireEvent.change(screen.getByLabelText('Group 1 starting hole'), { target: { value: '7' } });
    await showGames();
    expect(source.client.create).toHaveBeenCalledOnce();
    expect(vi.mocked(source.client.create).mock.calls[0]?.[1].rounds[0]?.groups[0]?.startingHole).toBe(7);
    expect(screen.getByRole('region', { name: 'Shared starting holes' })).toHaveTextContent('Group 1 starts at hole 7');
    fireEvent.change(screen.getByLabelText('Score basis'), { target: { value: 'net' } });
    expect(screen.getByLabelText('Net handicap rule')).toHaveValue('full-course-v1');
    fireEvent.change(screen.getByLabelText('Net handicap rule'), { target: { value: 'group-low-v1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save game' }));
    await screen.findByText('Game settings saved.');
    expect(vi.mocked(source.scores.saveGames).mock.calls[0]?.[2][0]).toMatchObject({ handicapRule: 'group-low-v1', basis: 'net' });
    expect(source.client.save).not.toHaveBeenCalled();
    expect(source.scores.save).not.toHaveBeenCalled();
    expect(source.scores.load).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Back to round setup' }));
    expect(screen.getByLabelText('Group 1 starting hole')).toHaveValue('7');
  });
  it('retries Add games with the same setup identity and waits for scoring context before opening the editor', async () => {
    const source = quickSource();
    vi.mocked(source.client.create).mockRejectedValueOnce(new Error('Fictional interrupted setup'));
    const load = vi.mocked(source.scores.load).getMockImplementation();
    if (!load) throw new Error('Missing fictional scores reader');
    let finish: (() => void) | undefined;
    vi.mocked(source.scores.load).mockImplementationOnce(async (...args) => {
      const value = await load(...args);
      return new Promise((resolve) => { finish = () => { resolve(value); }; });
    });
    render(<QuickRoundView {...source} />);
    await choose();
    expect(screen.queryByRole('button', { name: 'Save round' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add games' }));
    await screen.findByText(/Save is not confirmed/);
    expect(screen.getByRole('button', { name: 'Start scoring' })).toBeDisabled();
    expect(screen.getByLabelText('Round / event name')).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Retry Add games' }));
    await waitFor(() => { expect(finish).toBeDefined(); });
    expect(vi.mocked(source.client.create).mock.calls[1]?.slice(0, 2)).toEqual(vi.mocked(source.client.create).mock.calls[0]?.slice(0, 2));
    expect(screen.queryByRole('form', { name: 'Game settings' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add games' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Start scoring' })).toBeDisabled();
    expect(screen.getByLabelText('Round / event name')).toBeDisabled();
    expect(window.location.hash).toContain('quick=1');
    act(() => { finish?.(); });
    expect(await screen.findByRole('form', { name: 'Game settings' })).toBeVisible();
    expect(screen.getByLabelText('Game name')).toHaveValue('Stableford');
    expect(source.client.create).toHaveBeenCalledTimes(2);
    expect(source.scores.saveGames).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Start scoring' })).toBeDisabled();
  });

  it('resumes a failed post-save scoring read without a second create or a fabricated successful game', async () => {
    const source = quickSource();
    vi.mocked(source.scores.load).mockRejectedValueOnce(new Error('Fictional post-save read outage'));
    render(<QuickRoundView {...source} />);
    await choose();
    fireEvent.click(screen.getByRole('button', { name: 'Start scoring' }));
    await screen.findByText(/Fictional post-save read outage/);
    expect(source.client.create).toHaveBeenCalledOnce();
    expect(window.location.hash).toContain('quick=1');
    expect(screen.getByRole('button', { name: 'Start scoring' })).toBeDisabled();
    expect(screen.getByLabelText('Round / event name')).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Retry loading games' }));
    await waitFor(() => { expect(window.location.hash).toContain('&round='); });
    expect(window.location.hash).not.toContain('quick=1');
    expect(source.client.create).toHaveBeenCalledOnce();
    expect(source.client.save).not.toHaveBeenCalled();
    expect(source.scores.saveGames).not.toHaveBeenCalled();
  });

  it('requires one name for both identities and starts ordinary score entry without creating a game', async () => {
    const source = quickSource();
    render(<QuickRoundView {...source} />);
    await choose();
    const name = screen.getByLabelText('Round / event name');
    fireEvent.change(name, { target: { value: '   ' } });
    expect(screen.getByRole('button', { name: 'Start scoring' })).toBeDisabled();
    expect(source.client.create).not.toHaveBeenCalled();
    fireEvent.change(name, { target: { value: 'Fictional weekday nine' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start scoring' }));
    await waitFor(() => { expect(screen.getByRole('button', { name: 'Start scoring' })).toBeEnabled(); });
    expect(screen.getByRole('button', { name: 'Add games' })).toBeEnabled();
    expect(screen.queryByRole('form', { name: 'Game settings' })).not.toBeInTheDocument();
    expect(vi.mocked(source.client.create).mock.lastCall?.[1]).toMatchObject({
      name: 'Fictional weekday nine', rounds: [{ name: 'Fictional weekday nine' }],
    });
    fireEvent.click(screen.getByRole('button', { name: 'Start scoring' }));
    const id = vi.mocked(source.client.create).mock.lastCall?.[0];
    expect(window.location.hash).toContain(`event=${id ?? ''}`);
    expect(window.location.hash).toContain(`round=${vi.mocked(source.client.create).mock.lastCall?.[1].rounds[0]?.id ?? ''}`);
    expect(window.location.hash).not.toContain('quick=1');
    expect(source.scores.saveGames).not.toHaveBeenCalled();
    expect(source.scores.save).not.toHaveBeenCalled();
  });

  it('lets a reopened unscored Quick round change golfers and retains the saved roster on another visit', async () => {
    const source = quickSource();
    const view = render(<QuickRoundView {...source} eventId={source.workspace.event.id} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add golfers' }));
    const selected = await screen.findByRole('checkbox', { name: 'Fictional Player 1' });
    await waitFor(() => { expect(selected).toBeEnabled(); });
    expect(selected).toBeChecked();
    fireEvent.click(selected);
    await waitFor(() => { expect(screen.getByRole('button', { name: 'Start scoring' })).toBeEnabled(); });
    fireEvent.click(screen.getByRole('button', { name: 'Start scoring' }));
    await screen.findByText('Round setup saved.');
    const saved = vi.mocked(source.client.save).mock.lastCall?.[3];
    expect(saved?.playerIds).not.toContain(fictionalId(1));
    expect(saved?.rounds[0]?.groups.every((group) => !group.playerIds.includes(fictionalId(1)))).toBe(true);
    expect(source.scores.save).not.toHaveBeenCalled();
    view.unmount();
    render(<QuickRoundView {...source} eventId={source.workspace.event.id} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add golfers' }));
    const reopened = await screen.findByRole('checkbox', { name: 'Fictional Player 1' });
    await waitFor(() => { expect(reopened).toBeEnabled(); });
    expect(reopened).not.toBeChecked();
  });

  it('prefers captured server Course Handicap when scoring locks after the workspace read', async () => {
    const source = quickSource();
    const current = await source.scores.load(source.workspace.event.id, source.workspace.rounds[0]?.id ?? '', new AbortController().signal);
    vi.mocked(source.scores.load).mockResolvedValue({ ...current, setupLocked: true,
      courseHandicaps: current.cards.map((card, index) => ({ playerId: card.playerId, courseHandicap: index === 0 ? -2 : 0 })) });
    render(<QuickRoundView {...source} eventId={source.workspace.event.id} />);
    expect(await screen.findByLabelText('Course handicap: +2')).toHaveTextContent('CH +2');
    expect(screen.getAllByLabelText('Course handicap: 0')).toHaveLength(3);
    expect(screen.getByLabelText('Course', { exact: true })).toBeDisabled();
    expect(source.client.load).toHaveBeenCalledOnce();
  });

  it('refreshes captured workspace inputs when an overlapping scoring lock lacks a handicap projection', async () => {
    const source = quickSource();
    const current = await source.scores.load(source.workspace.event.id, source.workspace.rounds[0]?.id ?? '', new AbortController().signal);
    const locked = { ...current, setupLocked: true };
    delete locked.courseHandicaps;
    vi.mocked(source.scores.load).mockResolvedValue(locked);
    let finish: ((workspace: typeof source.workspace) => void) | undefined;
    vi.mocked(source.client.load).mockResolvedValueOnce(source.workspace)
      .mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    render(<QuickRoundView {...source} eventId={source.workspace.event.id} />);
    await waitFor(() => { expect(finish).toBeDefined(); });
    await act(async () => { finish?.({ ...source.workspace, etag: 'captured-workspace',
      rounds: source.workspace.rounds.map((round) => ({ ...round, scoringStarted: true,
        players: round.players.map((player) => ({ ...player, handicapIndexValue: '+4.0' })) })) }); await Promise.resolve(); });
    expect(await screen.findByText(/Scoring has started/)).toBeVisible();
    expect(screen.getAllByLabelText('Course handicap: +2')).toHaveLength(4);
    expect(screen.getByLabelText('Course', { exact: true })).toBeDisabled();
    expect(source.client.load).toHaveBeenCalledTimes(2);
  });

  it('adopts the authoritative event revision after a game acknowledgement without remounting its pending editor', async () => {
    const source = quickSource();
    render(<QuickRoundView {...source} eventId={source.workspace.event.id} />);
    await showGames();
    let finish: ((workspace: typeof source.workspace) => void) | undefined;
    vi.mocked(source.client.load).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    fireEvent.change(screen.getByLabelText('Game name'), { target: { value: 'Fictional refreshed game' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save game' }));
    await waitFor(() => { expect(finish).toBeDefined(); });
    expect(screen.getByLabelText('Game name')).toHaveValue('Fictional refreshed game');
    expect(screen.getByLabelText('Game name')).toBeDisabled();
    expect(screen.queryByText('Game settings saved.')).not.toBeInTheDocument();
    const latest = { ...source.workspace, etag: 'after-game-event-revision',
      event: { ...source.workspace.event, etag: 'after-game-event-revision' } };
    await act(async () => { finish?.(latest); await Promise.resolve(); });
    await screen.findByText('Game settings saved.');
    expect(source.scores.load).toHaveBeenCalledOnce();
    expect(source.scores.saveGames).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Back to round setup' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open full setup' }));
    fireEvent.change(screen.getByLabelText('Round / event name'), { target: { value: 'Fictional after-game setup' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start scoring' }));
    await screen.findByText('Round setup saved.');
    expect(source.client.save).toHaveBeenCalledWith(source.workspace.event.id, latest.etag, expect.any(String),
      expect.objectContaining({ name: 'Fictional after-game setup' }), expect.any(AbortSignal));
  });

  it('keeps an acknowledged game successful if setup reload fails and blocks setup writes until explicit refresh', async () => {
    const source = quickSource();
    render(<QuickRoundView {...source} eventId={source.workspace.event.id} />);
    await showGames();
    vi.mocked(source.client.load).mockRejectedValueOnce(new Error('Fictional post-game workspace outage'));
    fireEvent.change(screen.getByLabelText('Game name'), { target: { value: 'Fictional acknowledged game' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save game' }));
    await screen.findByText('Game settings saved.');
    expect(screen.getByRole('alert')).toHaveTextContent('Game settings saved. Setup refresh required');
    expect(screen.queryByRole('button', { name: 'Retry save' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Back to round setup' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open full setup' }));
    fireEvent.change(screen.getByLabelText('Round / event name'), { target: { value: 'Fictional retained setup' } });
    expect(screen.getByRole('button', { name: 'Start scoring' })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('Setup refresh required');
    expect(source.client.save).not.toHaveBeenCalled();
    vi.mocked(source.client.load).mockResolvedValueOnce({ ...source.workspace, etag: 'reviewed-after-game' });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh & review setup' }));
    await screen.findByRole('button', { name: 'Use latest revision for my draft' });
    expect(screen.getByLabelText('Round / event name')).toHaveValue('Fictional retained setup');
    expect(screen.getByRole('button', { name: 'Start scoring' })).toBeEnabled();
    expect(source.scores.saveGames).toHaveBeenCalledOnce();
  });

  it('preserves local setup for explicit review when shared setup changes during the post-game read', async () => {
    const source = quickSource();
    render(<QuickRoundView {...source} eventId={source.workspace.event.id} />);
    await showGames();
    vi.mocked(source.client.load).mockResolvedValueOnce({ ...source.workspace, etag: 'remote-setup-after-game',
      event: { ...source.workspace.event, name: 'Fictional remote renamed setup' } });
    fireEvent.change(screen.getByLabelText('Game name'), { target: { value: 'Fictional concurrent game' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save game' }));
    await screen.findByText('Game settings saved.');
    expect(screen.getByRole('alert')).toHaveTextContent('shared setup changed. Your setup draft is retained');
    fireEvent.click(screen.getByRole('button', { name: 'Back to round setup' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open full setup' }));
    expect(screen.getByLabelText('Round / event name')).toHaveValue(source.workspace.event.name);
    expect(screen.getByRole('button', { name: 'Start scoring' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Start scoring' })).toBeDisabled();
    expect(source.client.save).not.toHaveBeenCalled();
  });

  it('shows the saved game count and lets Add games open setup without inventing a scores-only mode', async () => {
    const source = quickSource();
    const initial = await source.scores.load(source.workspace.event.id, source.workspace.rounds[0]?.id ?? '', new AbortController().signal);
    vi.mocked(source.scores.load).mockImplementation((eventId, roundId) => Promise.resolve(gameResult([{
      id: fictionalId(801), name: 'Fictional already saved game', preset: 'standard', basis: 'gross',
      handicapAllowancePercent: 95, points: stablefordPoints('standard'),
    }], null, fictionalId(802), { ...initial, eventId, roundId }).round));
    render(<QuickRoundView {...source} />);
    await choose();
    fireEvent.click(screen.getByRole('button', { name: 'Start scoring' }));
    expect(await screen.findByText('1 saved game')).toBeVisible();
    await waitFor(() => { expect(screen.getByRole('button', { name: 'Start scoring' })).toBeEnabled(); });
    await showGames();
    expect(await screen.findByRole('button', { name: 'Edit Fictional already saved game' })).toBeVisible();
    expect(screen.queryByLabelText('Scores only')).not.toBeInTheDocument();
  });

  it('creates exactly one round, splits five golfers into groups, saves starting holes and keeps the full setup draft', async () => {
    const source = quickSource();
    render(<QuickRoundView {...source} />);
    await choose();
    for (let index = 2; index <= 5; index++) fireEvent.click(screen.getByLabelText(`Fictional Player ${String(index)}`, { exact: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Done choosing golfers' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit Group 2' }));
    fireEvent.change(screen.getByLabelText('Group 2 starting hole'), { target: { value: '5' } });
    expect(screen.getByLabelText('No captured Handicap Index')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Open full setup' }));
    fireEvent.change(screen.getByLabelText('Round / event name'), { target: { value: 'Fictional quick outing' } });
    fireEvent.change(screen.getByLabelText('Tee time'), { target: { value: '09:30' } });
    fireEvent.click(screen.getByLabelText('Personal tees'));
    fireEvent.click(screen.getByRole('button', { name: 'Edit Group 1' }));
    fireEvent.change(screen.getByLabelText('Fictional Player 1 tee'), { target: { value: '905' } });
    fireEvent.click(screen.getByRole('button', { name: 'Compact setup' }));
    fireEvent.click(screen.getByRole('button', { name: 'Start scoring' }));
    await screen.findByText('Round setup saved.');
    await waitFor(() => { expect(screen.getByRole('button', { name: 'Start scoring' })).toBeEnabled(); });
    const call = vi.mocked(source.client.create).mock.calls[0];
    expect(call?.[1]).toMatchObject({ name: 'Fictional quick outing', allowPerGolferTees: true,
      rounds: [{ name: 'Fictional quick outing', teeTime: '09:30', groups: [{ playerIds: [1, 2, 3, 4].map(fictionalId) }, { startingHole: 5, playerIds: [fictionalId(5)] }],
        playerTeeSelections: [{ playerId: fictionalId(1), teeProfileId: 905 }] }] });
    expect(call?.[1].rounds).toHaveLength(1);
    expect(source.client.save).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Start scoring' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Open full setup' }));
    expect(screen.getByLabelText('Tee time')).toHaveValue('09:30');
    expect(screen.getByLabelText('Round / event name')).toHaveValue('Fictional quick outing');
    expect(screen.queryByRole('button', { name: /Archive|Delete|Add round|Purse|Import/ })).not.toBeInTheDocument();
  });

  it('retains the creation identity and fixed payload after an uncertain write; full setup never discards it', async () => {
    const source = quickSource();
    const create = vi.mocked(source.client.create);
    create.mockRejectedValueOnce(new Error('Fictional network interruption'));
    render(<QuickRoundView {...source} />);
    await choose();
    fireEvent.click(screen.getByRole('button', { name: 'Start scoring' }));
    await screen.findByText(/Save is not confirmed/);
    const first = create.mock.calls[0];
    fireEvent.click(screen.getByRole('button', { name: 'Open full setup' }));
    expect(screen.getByLabelText('Round / event name')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Start scoring' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry Start scoring' }));
    await showGames();
    const retry = create.mock.calls[1];
    expect(retry?.slice(0, 2)).toEqual(first?.slice(0, 2));
    expect(source.client.save).not.toHaveBeenCalled();
  });

  it('retains a saved round after games fail to load, and never starts scoring over dirty or unconfirmed game settings', async () => {
    const source = quickSource();
    vi.mocked(source.scores.load).mockRejectedValueOnce(new Error('Fictional games read failed'));
    render(<QuickRoundView {...source} />);
    await choose();
    fireEvent.click(screen.getByRole('button', { name: 'Start scoring' }));
    await screen.findByText(/Setup is saved. Games could not load/);
    expect(screen.getByRole('button', { name: 'Start scoring' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Retry loading games' }));
    await showGames();
    expect(screen.getByRole('button', { name: 'Start scoring' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Back to round setup' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Game type'), { target: { value: 'skins' } });
    fireEvent.change(screen.getByLabelText('Game name'), { target: { value: 'Fictional skins' } });
    vi.mocked(source.scores.saveGames).mockRejectedValueOnce(new Error('Fictional game interruption'));
    fireEvent.click(screen.getByRole('button', { name: 'Save game' }));
    await screen.findByText('Fictional game interruption');
    expect(screen.getByRole('button', { name: 'Start scoring' })).toBeDisabled();
    const first = vi.mocked(source.scores.saveGames).mock.calls[0];
    fireEvent.click(screen.getByRole('button', { name: 'Retry save' }));
    await screen.findByText('Game settings saved.');
    expect(vi.mocked(source.scores.saveGames).mock.calls[1]?.slice(0, 5)).toEqual(first?.slice(0, 5));
    expect(first?.[2][0]).toMatchObject({ kind: 'skins' });
    expect(screen.getByRole('button', { name: 'Start scoring' })).toBeEnabled();
  });

  it('retains cursor progress across a failed directory page and only searches after completion', async () => {
    const source = quickSource();
    const item = { id: fictionalId(1), displayName: 'Fictional Player 1', handicapIndexValue: null };
    let finish: ((value: QuickPage<QuickPlayer>) => void) | undefined;
    vi.mocked(source.client.players).mockResolvedValueOnce({ items: [item], continuationToken: 'next' })
      .mockRejectedValueOnce(new Error('Fictional quota pause'))
      .mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    render(<QuickRoundView {...source} />);
    await screen.findByText(/Golfers incomplete/);
    expect(screen.queryByLabelText('Find saved golfers')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry golfers' }));
    await waitFor(() => { expect(finish).toBeDefined(); });
    expect(source.client.players).toHaveBeenLastCalledWith(expect.any(AbortSignal), 'next');
    await act(async () => { finish?.({ items: [{ ...item, id: fictionalId(2), displayName: 'Fictional second page' }] }); await Promise.resolve(); });
    fireEvent.click(await screen.findByRole('button', { name: 'Add golfers' }));
    expect(await screen.findByLabelText('Find saved golfers')).toBeVisible();
    expect(screen.getByLabelText('Fictional Player 1', { exact: true })).toBeVisible();
    expect(screen.getByLabelText('Fictional second page', { exact: true })).toBeVisible();
  });

  it('reopens public setup without inventing private observations and preserves locks after scoring', async () => {
    const source = quickSource();
    vi.mocked(source.client.load).mockResolvedValue({ ...source.workspace,
      rounds: source.workspace.rounds.map((round) => ({ ...round, scoringStarted: true,
        players: round.players.map((player) => ({ ...player, handicapIndexValue: '0' })) })) });
    render(<QuickRoundView {...source} eventId={source.workspace.event.id} />);
    await screen.findByText(/Scoring has started/);
    expect(screen.getByLabelText('Course', { exact: true })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Add golfers' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Open full setup' }));
    expect(screen.queryByLabelText('Round name')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Event name')).toBeEnabled();
    expect(screen.getByLabelText('Tee time')).toBeEnabled();
    expect(screen.getAllByLabelText('Course handicap: 0')).toHaveLength(4);
    expect(source.client.create).not.toHaveBeenCalled();
  });

  it('recovers a created-but-unconfirmed round through refresh/review without creating another event', async () => {
    const source = quickSource();
    vi.mocked(source.client.create).mockRejectedValueOnce(new EventChangedError('Created, but setup changed before reload.'));
    render(<QuickRoundView {...source} />);
    await choose();
    fireEvent.click(screen.getByRole('button', { name: 'Start scoring' }));
    await screen.findByText(/Created, but setup changed/);
    const created = vi.mocked(source.client.create).mock.calls[0];
    if (!created) throw new Error('Missing fictional creation');
    const [id, input] = created;
    vi.mocked(source.client.load).mockRejectedValueOnce(new Error('Fictional review read failed'))
      .mockResolvedValueOnce({ ...quickWorkspace(id, { ...input, name: 'Fictional newer shared setup' }), etag: 'quick-latest' });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh & review setup' }));
    await screen.findByText(/Fictional review read failed/);
    expect(screen.getByRole('button', { name: 'Retry Start scoring' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh & review setup' }));
    await screen.findByRole('button', { name: 'Use latest revision for my draft' });
    fireEvent.click(screen.getByRole('button', { name: 'Open full setup' }));
    expect(screen.getByLabelText('Round / event name')).toHaveValue(input.name);
    fireEvent.click(screen.getByRole('button', { name: 'Use latest revision for my draft' }));
    fireEvent.click(screen.getByRole('button', { name: 'Start scoring' }));
    await screen.findByText('Round setup saved.');
    expect(source.client.create).toHaveBeenCalledOnce();
    expect(source.client.save).toHaveBeenCalledWith(id, 'quick-latest', expect.any(String), input, expect.any(AbortSignal));
  });

  it('keeps a pending course version read through full setup changes and aborts it safely on unmount', async () => {
    const source = quickSource();
    let finish: ((value: typeof fictionalVersion) => void) | undefined;
    vi.mocked(source.client.version).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const view = render(<QuickRoundView {...source} />);
    fireEvent.change(await screen.findByRole('combobox', { name: 'Course' }), { target: { value: fictionalVersion.courseId } });
    await waitFor(() => { expect(finish).toBeDefined(); });
    fireEvent.click(screen.getByRole('button', { name: 'Open full setup' }));
    fireEvent.change(screen.getByLabelText('Round / event name'), { target: { value: 'Fictional waiting draft' } });
    fireEvent.click(screen.getByRole('button', { name: 'Compact setup' }));
    await act(async () => { finish?.(fictionalVersion); await Promise.resolve(); });
    expect(screen.getByRole('option', { name: 'Fictional Teal / Fictional A / 9 holes' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open full setup' }));
    expect(screen.getByLabelText('Round / event name')).toHaveValue('Fictional waiting draft');
    expect(source.client.version).toHaveBeenCalledOnce();
    const signal = vi.mocked(source.client.version).mock.calls[0]?.[2];
    view.unmount();
    expect(signal?.aborted).toBe(true);
    expect(source.client.create).not.toHaveBeenCalled();
  });

  it('keeps setup retry identity until explicit refresh/review, preserves the draft and blocks new stale writes', async () => {
    const source = quickSource();
    const user = userEvent.setup();
    vi.mocked(source.client.save).mockRejectedValueOnce(new Error('Fictional uncertain save'));
    render(<QuickRoundView {...source} eventId={source.workspace.event.id} />);
    await screen.findByLabelText('Course', { exact: true });
    await user.click(screen.getByRole('button', { name: 'Open full setup' }));
    fireEvent.change(screen.getByLabelText('Round / event name'), { target: { value: 'Fictional edited outing' } });
    await waitFor(() => { expect(screen.getByRole('button', { name: 'Start scoring' })).toBeEnabled(); });
    await user.click(screen.getByRole('button', { name: 'Start scoring' }));
    await screen.findByText(/Save is not confirmed/);
    const first = vi.mocked(source.client.save).mock.calls[0];
    await user.click(screen.getByRole('button', { name: 'Retry Start scoring' }));
    await screen.findByText('Round setup saved.');
    await waitFor(() => { expect(screen.getByLabelText('Round / event name')).toBeEnabled(); });
    expect(vi.mocked(source.client.save).mock.calls[1]?.slice(0, 4)).toEqual(first?.slice(0, 4));
    fireEvent.change(screen.getByLabelText('Round / event name'), { target: { value: 'Fictional conflict draft' } });
    vi.mocked(source.client.save).mockRejectedValueOnce(new EventChangedError('Fictional conflict'));
    await user.click(screen.getByRole('button', { name: 'Start scoring' }));
    await screen.findByText(/Fictional conflict/);
    expect(screen.getByRole('button', { name: 'Retry Start scoring' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Add games' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Refresh & review setup' }));
    await screen.findByRole('button', { name: 'Use latest revision for my draft' });
    expect(screen.getByLabelText('Round / event name')).toHaveValue('Fictional conflict draft');
    await user.click(screen.getByRole('button', { name: 'Use latest revision for my draft' }));
    expect(screen.getByRole('button', { name: 'Start scoring' })).toBeEnabled();
  });

  it('rejects ordinary events and cross-event creation acknowledgements without throwing away the pending draft', async () => {
    const source = quickSource();
    const ordinary = { ...source.workspace };
    delete ordinary.quickRound;
    vi.mocked(source.client.load).mockResolvedValue(ordinary);
    const view = render(<QuickRoundView {...source} eventId={source.workspace.event.id} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('not an editable public Quick round');
    expect(screen.queryByLabelText('Course', { exact: true })).not.toBeInTheDocument();
    view.unmount();
    vi.mocked(source.client.create).mockImplementation((_id, input) => Promise.resolve(quickWorkspace(fictionalId(999), input)));
    render(<QuickRoundView {...source} />);
    await choose();
    fireEvent.click(screen.getByRole('button', { name: 'Start scoring' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Save is not confirmed');
    expect(screen.getByRole('button', { name: 'Retry Start scoring' })).toBeEnabled();
    expect(screen.getByRole('option', { name: fictionalCourse.name })).toBeInTheDocument();
  });
});
