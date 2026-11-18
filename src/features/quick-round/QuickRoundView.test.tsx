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
  fireEvent.change(course, { target: { value: fictionalVersion.courseId } });
  await screen.findByRole('option', { name: 'Fictional Teal / Fictional A' });
  fireEvent.change(screen.getByLabelText('Default tee'), { target: { value: '901' } });
  fireEvent.click(screen.getByLabelText('Fictional Player 1', { exact: true }));
}

async function showGames() {
  const scoresOnly = await screen.findByLabelText('Scores only');
  if (screen.queryByRole('checkbox', { name: 'Scores only', checked: true })) fireEvent.click(scoresOnly);
  return screen.findByRole('button', { name: 'Add game' });
}

describe('public Quick round controller', () => {
  it('lets a reopened unscored Quick round change golfers and retains the saved roster on another visit', async () => {
    const source = quickSource();
    const view = render(<QuickRoundView {...source} eventId={source.workspace.event.id} />);
    const selected = await screen.findByRole('checkbox', { name: 'Fictional Player 1' });
    await waitFor(() => { expect(selected).toBeEnabled(); });
    expect(selected).toBeChecked();
    fireEvent.click(selected);
    await waitFor(() => { expect(screen.getByRole('button', { name: 'Save round' })).toBeEnabled(); });
    fireEvent.click(screen.getByRole('button', { name: 'Save round' }));
    await screen.findByText('Round setup saved. Choose games or start with scores only.');
    const saved = vi.mocked(source.client.save).mock.lastCall?.[3];
    expect(saved?.playerIds).not.toContain(fictionalId(1));
    expect(saved?.rounds[0]?.groups.every((group) => !group.playerIds.includes(fictionalId(1)))).toBe(true);
    expect(source.scores.save).not.toHaveBeenCalled();
    view.unmount();
    render(<QuickRoundView {...source} eventId={source.workspace.event.id} />);
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
    fireEvent.click(screen.getByRole('button', { name: 'Add game' }));
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
    fireEvent.click(screen.getByRole('button', { name: 'Open full setup' }));
    fireEvent.change(screen.getByLabelText('Event name'), { target: { value: 'Fictional after-game setup' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save round' }));
    await screen.findByText('Round setup saved. Choose games or start with scores only.');
    expect(source.client.save).toHaveBeenCalledWith(source.workspace.event.id, latest.etag, expect.any(String),
      expect.objectContaining({ name: 'Fictional after-game setup' }), expect.any(AbortSignal));
  });

  it('keeps an acknowledged game successful if setup reload fails and blocks setup writes until explicit refresh', async () => {
    const source = quickSource();
    render(<QuickRoundView {...source} eventId={source.workspace.event.id} />);
    await showGames();
    vi.mocked(source.client.load).mockRejectedValueOnce(new Error('Fictional post-game workspace outage'));
    fireEvent.click(screen.getByRole('button', { name: 'Add game' }));
    fireEvent.change(screen.getByLabelText('Game name'), { target: { value: 'Fictional acknowledged game' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save game' }));
    await screen.findByText('Game settings saved.');
    expect(screen.getByRole('alert')).toHaveTextContent('Game settings saved. Setup refresh required');
    expect(screen.queryByRole('button', { name: 'Retry save' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open full setup' }));
    fireEvent.change(screen.getByLabelText('Event name'), { target: { value: 'Fictional retained setup' } });
    expect(screen.getByRole('button', { name: 'Save round' })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('Setup refresh required');
    expect(source.client.save).not.toHaveBeenCalled();
    vi.mocked(source.client.load).mockResolvedValueOnce({ ...source.workspace, etag: 'reviewed-after-game' });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh & review setup' }));
    await screen.findByRole('button', { name: 'Use latest revision for my draft' });
    expect(screen.getByLabelText('Event name')).toHaveValue('Fictional retained setup');
    expect(screen.getByRole('button', { name: 'Save round' })).toBeEnabled();
    expect(source.scores.saveGames).toHaveBeenCalledOnce();
  });

  it('preserves local setup for explicit review when shared setup changes during the post-game read', async () => {
    const source = quickSource();
    render(<QuickRoundView {...source} eventId={source.workspace.event.id} />);
    await showGames();
    vi.mocked(source.client.load).mockResolvedValueOnce({ ...source.workspace, etag: 'remote-setup-after-game',
      event: { ...source.workspace.event, name: 'Fictional remote renamed setup' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add game' }));
    fireEvent.change(screen.getByLabelText('Game name'), { target: { value: 'Fictional concurrent game' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save game' }));
    await screen.findByText('Game settings saved.');
    expect(screen.getByRole('alert')).toHaveTextContent('shared setup changed. Your setup draft is retained');
    fireEvent.click(screen.getByRole('button', { name: 'Open full setup' }));
    expect(screen.getByLabelText('Event name')).toHaveValue(source.workspace.event.name);
    expect(screen.getByRole('button', { name: 'Save round' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Start scoring' })).toBeDisabled();
    expect(source.client.save).not.toHaveBeenCalled();
  });

  it('always shows saved games, even when a new-round controller defaults to scores only', async () => {
    const source = quickSource();
    const initial = await source.scores.load(source.workspace.event.id, source.workspace.rounds[0]?.id ?? '', new AbortController().signal);
    vi.mocked(source.scores.load).mockImplementation((eventId, roundId) => Promise.resolve(gameResult([{
      id: fictionalId(801), name: 'Fictional already saved game', preset: 'standard', basis: 'gross',
      handicapAllowancePercent: 95, points: stablefordPoints('standard'),
    }], null, fictionalId(802), { ...initial, eventId, roundId }).round));
    render(<QuickRoundView {...source} />);
    await choose();
    fireEvent.click(screen.getByRole('button', { name: 'Save round' }));
    expect(await screen.findByRole('button', { name: 'Edit Fictional already saved game' })).toBeVisible();
    expect(screen.getByLabelText('Scores only')).not.toBeChecked();
    expect(screen.getByLabelText('Scores only')).toBeDisabled();
  });

  it('creates exactly one round, splits five golfers into groups, saves starting holes and keeps the full setup draft', async () => {
    const source = quickSource();
    render(<QuickRoundView {...source} />);
    await choose();
    for (let index = 2; index <= 5; index++) fireEvent.click(screen.getByLabelText(`Fictional Player ${String(index)}`, { exact: true }));
    fireEvent.change(screen.getByLabelText('Group 2 starting hole'), { target: { value: '5' } });
    expect(screen.getByLabelText('No captured Handicap Index')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Open full setup' }));
    fireEvent.change(screen.getByLabelText('Event name'), { target: { value: 'Fictional quick outing' } });
    fireEvent.change(screen.getByLabelText('Tee time'), { target: { value: '09:30' } });
    fireEvent.click(screen.getByLabelText('Personal tees'));
    fireEvent.change(screen.getByLabelText('Fictional Player 1 tee'), { target: { value: '905' } });
    fireEvent.click(screen.getByRole('button', { name: 'Compact setup' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save round' }));
    expect(await screen.findByLabelText('Scores only')).toBeChecked();
    await showGames();
    const call = vi.mocked(source.client.create).mock.calls[0];
    expect(call?.[1]).toMatchObject({ name: 'Fictional quick outing', allowPerGolferTees: true,
      rounds: [{ teeTime: '09:30', groups: [{ playerIds: [1, 2, 3, 4].map(fictionalId) }, { startingHole: 5, playerIds: [fictionalId(5)] }],
        playerTeeSelections: [{ playerId: fictionalId(1), teeProfileId: 905 }] }] });
    expect(call?.[1].rounds).toHaveLength(1);
    expect(source.client.save).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Start scoring' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Open full setup' }));
    expect(screen.getByLabelText('Tee time')).toHaveValue('09:30');
    expect(screen.getByLabelText('Event name')).toHaveValue('Fictional quick outing');
    expect(screen.queryByRole('button', { name: /Archive|Delete|Add round|Purse|Import/ })).not.toBeInTheDocument();
  });

  it('retains the creation identity and fixed payload after an uncertain write; full setup never discards it', async () => {
    const source = quickSource();
    const create = vi.mocked(source.client.create);
    create.mockRejectedValueOnce(new Error('Fictional network interruption'));
    render(<QuickRoundView {...source} />);
    await choose();
    fireEvent.click(screen.getByRole('button', { name: 'Save round' }));
    await screen.findByText(/Save is not confirmed/);
    const first = create.mock.calls[0];
    fireEvent.click(screen.getByRole('button', { name: 'Open full setup' }));
    expect(screen.getByLabelText('Event name')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Start scoring' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry same setup save' }));
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
    fireEvent.click(screen.getByRole('button', { name: 'Save round' }));
    await screen.findByText(/Setup is saved. Games could not load/);
    expect(screen.getByRole('button', { name: 'Start scoring' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Retry loading games' }));
    await showGames();
    fireEvent.click(screen.getByRole('button', { name: 'Add game' }));
    expect(screen.getByRole('button', { name: 'Start scoring' })).toBeDisabled();
    expect(screen.getByLabelText('Scores only')).toBeDisabled();
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
    expect(screen.getByLabelText('Fictional Player 1', { exact: true })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Open full setup' }));
    expect(screen.getByLabelText('Round name')).toBeDisabled();
    expect(screen.getByLabelText('Tee time')).toBeEnabled();
    expect(screen.getAllByLabelText('Course handicap: 0')).toHaveLength(4);
    expect(source.client.create).not.toHaveBeenCalled();
  });

  it('recovers a created-but-unconfirmed round through refresh/review without creating another event', async () => {
    const source = quickSource();
    vi.mocked(source.client.create).mockRejectedValueOnce(new EventChangedError('Created, but setup changed before reload.'));
    render(<QuickRoundView {...source} />);
    await choose();
    fireEvent.click(screen.getByRole('button', { name: 'Save round' }));
    await screen.findByText(/Created, but setup changed/);
    const created = vi.mocked(source.client.create).mock.calls[0];
    if (!created) throw new Error('Missing fictional creation');
    const [id, input] = created;
    vi.mocked(source.client.load).mockRejectedValueOnce(new Error('Fictional review read failed'))
      .mockResolvedValueOnce({ ...quickWorkspace(id, { ...input, name: 'Fictional newer shared setup' }), etag: 'quick-latest' });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh & review setup' }));
    await screen.findByText(/Fictional review read failed/);
    expect(screen.getByRole('button', { name: 'Retry same setup save' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh & review setup' }));
    await screen.findByRole('button', { name: 'Use latest revision for my draft' });
    fireEvent.click(screen.getByRole('button', { name: 'Open full setup' }));
    expect(screen.getByLabelText('Event name')).toHaveValue(input.name);
    fireEvent.click(screen.getByRole('button', { name: 'Use latest revision for my draft' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save round' }));
    await screen.findByText('Round setup saved. Choose games or start with scores only.');
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
    fireEvent.change(screen.getByLabelText('Event name'), { target: { value: 'Fictional waiting draft' } });
    fireEvent.click(screen.getByRole('button', { name: 'Compact setup' }));
    await act(async () => { finish?.(fictionalVersion); await Promise.resolve(); });
    expect(screen.getByRole('option', { name: 'Fictional Teal / Fictional A' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open full setup' }));
    expect(screen.getByLabelText('Event name')).toHaveValue('Fictional waiting draft');
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
    fireEvent.change(screen.getByLabelText('Event name'), { target: { value: 'Fictional edited outing' } });
    await waitFor(() => { expect(screen.getByRole('button', { name: 'Save round' })).toBeEnabled(); });
    await user.click(screen.getByRole('button', { name: 'Save round' }));
    await screen.findByText(/Save is not confirmed/);
    const first = vi.mocked(source.client.save).mock.calls[0];
    await user.click(screen.getByRole('button', { name: 'Retry same setup save' }));
    await screen.findByText('Round setup saved. Choose games or start with scores only.');
    expect(vi.mocked(source.client.save).mock.calls[1]?.slice(0, 4)).toEqual(first?.slice(0, 4));
    fireEvent.change(screen.getByLabelText('Event name'), { target: { value: 'Fictional conflict draft' } });
    vi.mocked(source.client.save).mockRejectedValueOnce(new EventChangedError('Fictional conflict'));
    await user.click(screen.getByRole('button', { name: 'Save round' }));
    await screen.findByText(/Fictional conflict/);
    expect(screen.getByRole('button', { name: 'Retry same setup save' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Start scoring' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Refresh & review setup' }));
    await screen.findByRole('button', { name: 'Use latest revision for my draft' });
    expect(screen.getByLabelText('Event name')).toHaveValue('Fictional conflict draft');
    await user.click(screen.getByRole('button', { name: 'Use latest revision for my draft' }));
    expect(screen.getByRole('button', { name: 'Save round' })).toBeEnabled();
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
    fireEvent.click(screen.getByRole('button', { name: 'Save round' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Save is not confirmed');
    expect(screen.getByRole('button', { name: 'Retry same setup save' })).toBeEnabled();
    expect(screen.getByRole('option', { name: fictionalCourse.name })).toBeInTheDocument();
  });
});
