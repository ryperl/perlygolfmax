import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { fictionalId } from '../../client/catalog.test-support';
import { EventChangedError } from '../../client/events';
import { fictionalRoundScores, gameResult, withGameResults } from '../../client/scoring.test-support';
import type { RoundGameDefinition } from '../../domain/games';
import type { GameWriteResult, RoundScores } from '../../domain/scoring';
import { stablefordPoints } from '../../domain/stableford';
import { RoundGamesPanel } from './index';
import type { RoundGamesPanelProps } from './index';

const original: RoundGameDefinition = {
  id: fictionalId(701), name: 'Fictional original game', preset: 'standard', basis: 'gross',
  handicapAllowancePercent: 95, points: stablefordPoints('standard'),
};
const configured = withGameResults(fictionalRoundScores, [original], 'fictional-base');
const peer: RoundGameDefinition = {
  ...original, id: fictionalId(702), name: 'Fictional peer game', basis: 'net',
  preset: 'modified', points: stablefordPoints('modified'),
};

function setup(round: RoundScores = fictionalRoundScores) {
  const onSave = vi.fn<RoundGamesPanelProps['onSave']>().mockImplementation(
    (games, etag, id) => Promise.resolve(gameResult(games, etag, id, round)),
  );
  const onRefresh = vi.fn<RoundGamesPanelProps['onRefresh']>().mockResolvedValue(round);
  const onDirtyChange = vi.fn<RoundGamesPanelProps['onDirtyChange']>();
  const props = { round, busy: false, onSave, onRefresh, onDirtyChange };
  return { ...render(<RoundGamesPanel {...props} />), props, onSave, onRefresh, onDirtyChange };
}

function field(name: string, value: string) {
  fireEvent.change(screen.getByLabelText(name), { target: { value } });
}
function click(name: string) {
  fireEvent.click(screen.getByRole('button', { name }));
}
async function saved() {
  await waitFor(() => { expect(screen.getByRole('status')).toHaveTextContent('Game settings saved.'); });
}

describe('RoundGamesPanel', () => {
  it('does not invent defaults for a legacy round and cancels an unsaved draft', () => {
    const { onSave, onDirtyChange } = setup();
    expect(screen.getByRole('heading', { name: `Games · ${fictionalRoundScores.roundName}` })).toBeVisible();
    expect(screen.getByText(fictionalRoundScores.eventName)).toBeVisible();
    expect(screen.getByText(`${fictionalRoundScores.courseName} · ${fictionalRoundScores.teeName} / ${fictionalRoundScores.teeCategory}`)).toBeVisible();
    expect(screen.getByText('No games configured for this round.')).toBeVisible();
    expect(onSave).not.toHaveBeenCalled();
    click('Add game');
    expect(screen.getByLabelText('Points at -4 relative to par')).toHaveValue('6');
    expect(screen.queryByLabelText('Handicap allowance (%)')).not.toBeInTheDocument();
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
    click('Cancel editing');
    expect(screen.queryByRole('form')).not.toBeInTheDocument();
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
    expect(onSave).not.toHaveBeenCalled();
  });

  it('saves several gross/net games from seeds and displays server-derived results in configured order', async () => {
    const { onSave, onDirtyChange, rerender, props } = setup();
    click('Add game');
    field('Game name', 'Fictional gross game');
    click('Save game');
    await saved();
    expect(onSave).toHaveBeenCalledOnce();
    const call = onSave.mock.calls[0];
    if (!call) throw new Error('Missing fictional save.');
    const [games, etag, id] = call;
    expect(etag).toBeNull();
    expect(id).toMatch(/^[a-f0-9-]{36}$/);
    expect(games[0]).toMatchObject({ name: 'Fictional gross game', basis: 'gross', handicapAllowancePercent: 95 });
    expect(games[0]?.id).not.toBe(id);
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
    rerender(<RoundGamesPanel {...props} round={gameResult(games, etag, id).round} />);
    click('Add game');
    field('Game name', 'Fictional net game');
    field('Points preset', 'modified');
    field('Score basis', 'net');
    expect(screen.getByLabelText('Handicap allowance (%)')).toHaveValue('95');
    field('Better than listed points', '13');
    field('Worse than listed points', '-6');
    click('Add better band');
    field('Points at -4 relative to par', '10');
    click('Save game');
    await saved();
    const second = onSave.mock.calls[1];
    if (!second) throw new Error('Missing second fictional save.');
    expect(second[0]).toHaveLength(2);
    expect(second[0][0]).toEqual(games[0]);
    expect(second[0][1]).toMatchObject({
      basis: 'net', preset: 'modified', handicapAllowancePercent: 95,
      points: { betterScorePoints: 13, worseScorePoints: -6, rows: [
        { scoreToPar: -4, points: 10 }, { scoreToPar: -3, points: 8 }, { scoreToPar: -2, points: 5 },
        { scoreToPar: -1, points: 2 }, { scoreToPar: 0, points: 0 },
        { scoreToPar: 1, points: -1 }, { scoreToPar: 2, points: -2 },
      ] },
    });
    rerender(<RoundGamesPanel {...props} round={gameResult(...second).round} />);
    expect(screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent))
      .toEqual(['Fictional gross game', 'Fictional net game']);
    expect(screen.queryByText(/ranking/i)).not.toBeInTheDocument();
  });

  it.each([
    ['Game name', ' '],
    ['Game name', 'x'.repeat(101)],
    ['Better than listed points', ''],
    ['Worse than listed points', '3.5'],
    ['Points at 0 relative to par', '9007199254740992'],
    ['Points at 0 relative to par', 'Infinity'],
  ])('does not call save for invalid %s = %j', (name, value) => {
    const { onSave } = setup();
    click('Add game');
    field(name, value);
    click('Save game');
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent('Check the game name');
  });

  it.each(['', '0', '101', '1.2'])('rejects invalid visible net allowance %j', (value) => {
    const { onSave } = setup();
    click('Add game');
    field('Score basis', 'net');
    field('Handicap allowance (%)', value);
    click('Save game');
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent('net allowance');
  });

  it('ignores a hidden invalid allowance for gross, accepting zero and negative points', async () => {
    const { onSave } = setup();
    click('Add game');
    field('Score basis', 'net');
    field('Handicap allowance (%)', '');
    field('Score basis', 'gross');
    field('Better than listed points', '0');
    field('Worse than listed points', '-3');
    click('Save game');
    await saved();
    expect(onSave.mock.calls[0]?.[0][0]).toMatchObject({
      handicapAllowancePercent: 95, points: { betterScorePoints: 0, worseScorePoints: -3 },
    });
  });

  it('retains the original body, request identity, game identity, and opening etag across uncertain failures and prop updates', async () => {
    const { onSave, props, rerender, onDirtyChange } = setup(configured);
    onSave.mockRejectedValueOnce(new Error('Connection interrupted.'));
    click(`Edit ${original.name}`);
    field('Game name', 'Fictional intended game');
    click('Save game');
    await screen.findByText('Connection interrupted.');
    const first = onSave.mock.calls[0];
    if (!first) throw new Error('Missing fictional attempt.');
    expect(first[1]).toBe('fictional-base');
    expect(first[0][0]?.id).toBe(original.id);
    rerender(<RoundGamesPanel {...props} round={withGameResults(fictionalRoundScores, [original, peer], 'fictional-newer')} />);
    expect(screen.getByLabelText('Game name')).toHaveValue('Fictional intended game');
    click('Retry save');
    await saved();
    expect(onSave.mock.calls[1]?.[0]).toBe(first[0]);
    expect(onSave.mock.calls[1]?.[1]).toBe(first[1]);
    expect(onSave.mock.calls[1]?.[2]).toBe(first[2]);
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
  });

  it('creates a new request only for a changed intent and keeps the original etag and game id', async () => {
    const { onSave } = setup(configured);
    onSave.mockRejectedValueOnce(new Error('Uncertain save.'));
    click(`Edit ${original.name}`);
    click('Save game');
    await screen.findByText('Uncertain save.');
    field('Game name', 'Fictional changed intent');
    click('Save game');
    await saved();
    expect(onSave.mock.calls[1]?.[2]).not.toBe(onSave.mock.calls[0]?.[2]);
    expect(onSave.mock.calls[1]?.[1]).toBe('fictional-base');
    expect(onSave.mock.calls[1]?.[0][0]?.id).toBe(original.id);
  });

  it('retains draft and request identity when the shared serial operation returns null', async () => {
    const { onSave, onDirtyChange } = setup();
    onSave.mockResolvedValueOnce(null);
    click('Add game');
    click('Save game');
    await screen.findByText(/Save is not confirmed/);
    expect(screen.getByLabelText('Game name')).toHaveValue('Standard Stableford');
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
    expect(screen.queryByText('Game settings saved.')).not.toBeInTheDocument();
    click('Retry save');
    await saved();
    expect(onSave.mock.calls[1]).toEqual(onSave.mock.calls[0]);
  });

  it('requires a nonnull explicit refresh and review after a conflict, preserving peer-added and peer-edited games', async () => {
    const initial = withGameResults(fictionalRoundScores, [original, peer], 'fictional-base');
    const { onSave, onRefresh, props, rerender } = setup(initial);
    onSave.mockRejectedValueOnce(new EventChangedError('Changed.'));
    click(`Edit ${original.name}`);
    field('Game name', 'Fictional my draft');
    click('Save game');
    await screen.findByText(/Game settings changed\. Your draft/);
    expect(screen.getByRole('button', { name: 'Retry save' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Review my game against latest settings' })).toBeDisabled();
    const added = { ...original, id: fictionalId(703), name: 'Fictional new peer game' };
    const peerEdited = { ...peer, name: 'Fictional peer edited elsewhere' };
    const changedOriginal = { ...original, name: 'Fictional original changed elsewhere' };
    const latest = withGameResults(fictionalRoundScores, [changedOriginal, peerEdited, added], 'fictional-latest');
    rerender(<RoundGamesPanel {...props} round={latest} />);
    expect(screen.getByLabelText('Game name')).toHaveValue('Fictional my draft');
    expect(screen.getByRole('button', { name: 'Review my game against latest settings' })).toBeDisabled();
    onRefresh.mockResolvedValueOnce(null);
    click('Refresh latest settings');
    await screen.findByText(/Refresh is not confirmed/);
    expect(screen.getByRole('button', { name: 'Review my game against latest settings' })).toBeDisabled();
    onRefresh.mockRejectedValueOnce(new Error('Refresh interrupted.'));
    click('Refresh latest settings');
    await screen.findByText('Refresh interrupted.');
    expect(screen.getByRole('button', { name: 'Review my game against latest settings' })).toBeDisabled();
    onRefresh.mockResolvedValueOnce(latest);
    click('Refresh latest settings');
    await screen.findByText('Latest settings loaded. Review your game before saving.');
    expect(screen.getByText(/This game changed in the latest settings/)).toBeVisible();
    expect(onSave).toHaveBeenCalledOnce();
    click('Review my game against latest settings');
    expect(screen.getByLabelText('Game name')).toHaveValue('Fictional my draft');
    click('Save game');
    await saved();
    const updated = onSave.mock.calls[1];
    expect(updated?.[1]).toBe('fictional-latest');
    expect(updated?.[2]).not.toBe(onSave.mock.calls[0]?.[2]);
    expect(updated?.[0]).toEqual([{ ...original, name: 'Fictional my draft' }, peerEdited, added]);
  });

  it('appends a conflicted new game to refreshed games without changing its original game id', async () => {
    const { onSave, onRefresh } = setup();
    onSave.mockRejectedValueOnce(new EventChangedError('Changed.'));
    onRefresh.mockResolvedValue(withGameResults(fictionalRoundScores, [peer], 'fictional-peer'));
    click('Add game');
    click('Save game');
    await screen.findByText(/Game settings changed\. Your draft/);
    field('Game name', 'Fictional new game');
    expect(screen.getByRole('button', { name: 'Save game' })).toBeDisabled();
    click('Refresh latest settings');
    await screen.findByText('Latest settings loaded. Review your game before saving.');
    click('Review my game against latest settings');
    click('Save game');
    await saved();
    expect(onSave.mock.calls[1]?.[0][0]).toEqual(peer);
    expect(onSave.mock.calls[1]?.[0][1]?.id).toEqual(onSave.mock.calls[0]?.[0][0]?.id);
  });

  it('treats a matching acknowledgement with a later differing projection as review-required, not latest saved', async () => {
    const { onSave, onRefresh, onDirtyChange } = setup(configured);
    const latest = withGameResults(fictionalRoundScores, [{ ...original, name: 'Fictional later game' }, peer], 'fictional-later');
    onSave.mockImplementationOnce((games, etag, id) => Promise.resolve({
      ...gameResult(games, etag, id, configured), round: latest,
    }));
    onRefresh.mockResolvedValue(latest);
    click(`Edit ${original.name}`);
    field('Game name', 'Fictional acknowledged intent');
    click('Save game');
    await screen.findByText(/Your save was acknowledged, but the latest settings differ/);
    expect(screen.queryByText('Game settings saved.')).not.toBeInTheDocument();
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
    expect(screen.getByLabelText('Game name')).toHaveValue('Fictional acknowledged intent');
    expect(screen.getByRole('button', { name: 'Review my game against latest settings' })).toBeDisabled();
    click('Refresh latest settings');
    await screen.findByText('Latest settings loaded. Review your game before saving.');
    click('Review my game against latest settings');
    click('Save game');
    await saved();
    expect(onSave.mock.calls[1]?.[0]).toEqual([{ ...original, name: 'Fictional acknowledged intent' }, peer]);
    expect(onSave.mock.calls[1]?.[2]).not.toBe(onSave.mock.calls[0]?.[2]);
  });

  it('does not clear a draft when the acknowledgement confirms a different intent', async () => {
    const { onSave, onDirtyChange } = setup(configured);
    onSave.mockImplementationOnce((_games, etag, id) => Promise.resolve(gameResult([peer], etag, id, configured)));
    click(`Edit ${original.name}`);
    click('Save game');
    await screen.findByText(/The response did not confirm these settings/);
    expect(screen.getByLabelText('Game name')).toHaveValue(original.name);
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
  });

  it('serializes local saves, respects parent busy, and preserves a draft that becomes archived', async () => {
    const { onSave, props, rerender } = setup(configured);
    let finish: ((value: GameWriteResult | null) => void) | undefined;
    onSave.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    click(`Edit ${original.name}`);
    field('Game name', 'Fictional retained draft');
    rerender(<RoundGamesPanel {...props} busy />);
    expect(screen.getByRole('button', { name: 'Save game' })).toBeDisabled();
    expect(screen.getByLabelText('Game name')).toBeDisabled();
    rerender(<RoundGamesPanel {...props} />);
    click('Save game');
    click('Retry save');
    expect(onSave).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Cancel editing' })).toBeDisabled();
    if (!finish) throw new Error('Missing fictional completion.');
    finish(null);
    await screen.findByText(/Save is not confirmed/);
    rerender(<RoundGamesPanel {...props} round={{ ...configured, eventStatus: 'archived' }} />);
    expect(screen.getByLabelText('Game name')).toHaveValue('Fictional retained draft');
    expect(screen.getByLabelText('Game name')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Retry save' })).toBeDisabled();
    expect(screen.getByText(/archived\. Game settings are read-only/)).toBeVisible();
    click('Cancel editing');
    expect(screen.queryByRole('button', { name: 'Add game' })).not.toBeInTheDocument();
  });

  it('shows archived results without editing controls and limits configured games without offering removal', () => {
    const { props, rerender } = setup({ ...configured, eventStatus: 'archived' });
    expect(screen.getByRole('button', { name: `Edit ${original.name}` })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Add game' })).not.toBeInTheDocument();
    const games = Array.from({ length: 16 }, (_, index) => ({ ...original, id: fictionalId(800 + index) }));
    rerender(<RoundGamesPanel {...props} round={withGameResults(fictionalRoundScores, games, 'fictional-full')} />);
    expect(screen.getByRole('button', { name: 'Add game' })).toBeDisabled();
    expect(screen.getByText('This round has reached the 16-game limit.')).toBeVisible();
    expect(screen.queryByRole('button', { name: /remove|delete/i })).not.toBeInTheDocument();
  });

  it('clears dirty on unmount and does not clear it just because the callback identity changes', () => {
    const { props, rerender, unmount, onDirtyChange } = setup();
    click('Add game');
    const replacement = vi.fn();
    rerender(<RoundGamesPanel {...props} onDirtyChange={replacement} />);
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
    expect(replacement).not.toHaveBeenCalled();
    unmount();
    expect(replacement).toHaveBeenLastCalledWith(false);
  });

  it('shows a safe failure for a non-Error rejection without pretending success', async () => {
    const { onSave } = setup();
    onSave.mockRejectedValueOnce('Fictional unexpected rejection');
    click('Add game');
    click('Save game');
    await screen.findByText('Save failed. Your draft is retained; retry to confirm.');
    expect(screen.getByRole('button', { name: 'Retry save' })).toBeEnabled();
  });
});
