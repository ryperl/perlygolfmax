import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { fakeSetup, fictionalId, fictionalWorkspace } from '../client/catalog.test-support';
import { fakeScores, fictionalRoundScores, gameResult } from '../client/scoring.test-support';
import { SessionExpiredError } from '../client/events';
import { OwnerRoundScoresPage } from './OwnerRoundScoresPage';

function fixture() {
  const first = fictionalWorkspace.rounds[0];
  if (!first) throw new Error('Missing fictional round.');
  const second = { ...first, id: fictionalId(71), name: 'Fictional second round', startDate: '2026-01-01' };
  const workspace = { ...fictionalWorkspace, rounds: [{ ...first, startDate: '2026-01-02' }, second] };
  const setup = fakeSetup();
  const scores = fakeScores();
  const round = (id: string) => ({ ...fictionalRoundScores, roundId: id, roundName: id === second.id ? second.name : first.name });
  vi.mocked(setup.load).mockResolvedValue(workspace);
  vi.mocked(scores.load).mockImplementation((_event, id) => Promise.resolve(round(id)));
  vi.mocked(scores.saveGames).mockImplementation((_event, id, games, etag, requestId) => Promise.resolve(gameResult(games, etag, requestId, round(id))));
  const props = { setup, scores, eventId: workspace.event.id, roundId: first.id, onSessionExpired: vi.fn() };
  return { props, second, ...render(<OwnerRoundScoresPage {...props} />) };
}

describe('owner round navigation', () => {
  it('orders saved rounds by date, retains Games across a switch, and blocks leaving unsaved game settings', async () => {
    const f = fixture();
    await screen.findByRole('heading', { name: 'Round scorecard' });
    const picker = screen.getByLabelText('Round');
    expect(within(picker).getAllByRole('option').map((option) => option.textContent))
      .toEqual([f.second.name, fictionalWorkspace.rounds[0]?.name]);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Games' }));
    await user.click(screen.getByRole('button', { name: 'Add game' }));
    expect(picker).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Cancel editing' }));
    expect(picker).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Add game' }));
    await user.click(screen.getByRole('button', { name: 'Save game' }));
    await screen.findByText('Game settings saved.');
    expect(picker).toBeEnabled();
    await user.selectOptions(picker, f.second.id);
    expect(window.location.hash).toBe(`#organizer?event=${f.props.eventId}&round=${f.second.id}`);
    f.rerender(<OwnerRoundScoresPage {...f.props} roundId={f.second.id} />);
    await screen.findByRole('heading', { name: `Games · ${f.second.name}` });
    expect(screen.getByRole('button', { name: 'Add game' })).toBeEnabled();
    expect(f.props.setup.load).toHaveBeenCalledOnce();
    expect(f.props.scores.load).toHaveBeenLastCalledWith(f.props.eventId, f.second.id, expect.any(AbortSignal));
  });

  it('blocks round switching for score drafts and in-flight reads without losing drafts on disclosure toggles', async () => {
    const f = fixture();
    await screen.findByRole('heading', { name: 'Round scorecard' });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Enter scores' }));
    const field = screen.getByRole('textbox', { name: 'Fictional Player 1 score' });
    fireEvent.change(field, { target: { value: '6' } });
    await user.click(screen.getByText('Round details & tools', { exact: true }));
    expect(screen.getByLabelText('Round')).toBeDisabled();
    expect(screen.getByLabelText('Round')).toBeVisible();
    expect(screen.getByLabelText('Round').closest('details')).toBeNull();
    await user.click(screen.getByText('Round details & tools', { exact: true }));
    expect(field).toHaveValue('6');
    await user.click(screen.getByRole('button', { name: 'Discard unsaved scores' }));
    await user.click(screen.getByText('Round details & tools', { exact: true }));
    expect(screen.getByLabelText('Round')).toBeEnabled();
    let finish: (() => void) | undefined;
    vi.mocked(f.props.scores.load).mockImplementationOnce(() => new Promise((resolve) => {
      finish = () => { resolve(fictionalRoundScores); };
    }));
    await user.click(screen.getByRole('button', { name: 'Refresh saved round' }));
    expect(screen.getByLabelText('Round')).toBeDisabled();
    await act(async () => { finish?.(); await Promise.resolve(); });
    await waitFor(() => { expect(screen.getByLabelText('Round')).toBeEnabled(); });
    expect(f.props.scores.save).not.toHaveBeenCalled();
  });

  it('does not fetch scores for a missing saved round and surfaces workspace failures', async () => {
    const f = fixture();
    f.rerender(<OwnerRoundScoresPage {...f.props} roundId={fictionalId(999)} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('no longer available');
    expect(f.props.scores.load).not.toHaveBeenCalled();
    const replacement = fakeSetup();
    vi.mocked(replacement.load).mockRejectedValue(new SessionExpiredError('Fictional workspace expired.'));
    f.rerender(<OwnerRoundScoresPage {...f.props} setup={replacement} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Fictional workspace expired.');
    expect(f.props.onSessionExpired).toHaveBeenCalledWith('Fictional workspace expired.');
  });

  it('keeps the picker blocked until a game save is acknowledged and recovers a failed workspace read explicitly', async () => {
    const f = fixture();
    await screen.findByRole('heading', { name: 'Round scorecard' });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Games' }));
    await user.click(screen.getByRole('button', { name: 'Add game' }));
    let acknowledge: (() => void) | undefined;
    vi.mocked(f.props.scores.saveGames).mockImplementationOnce((_event, id, games, etag, requestId) =>
      new Promise((resolve) => { acknowledge = () => { resolve(gameResult(games, etag, requestId, { ...fictionalRoundScores, roundId: id })); }; }));
    await user.click(screen.getByRole('button', { name: 'Save game' }));
    expect(screen.getByLabelText('Round')).toBeDisabled();
    await act(async () => { acknowledge?.(); await Promise.resolve(); });
    await screen.findByText('Game settings saved.');
    expect(screen.getByLabelText('Round')).toBeEnabled();
    const replacement = fakeSetup();
    vi.mocked(replacement.load).mockRejectedValueOnce(new Error('Fictional temporary failure.')).mockResolvedValue(fictionalWorkspace);
    f.rerender(<OwnerRoundScoresPage {...f.props} setup={replacement} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Fictional temporary failure.');
    await user.click(screen.getByRole('button', { name: 'Retry saved rounds' }));
    await screen.findByRole('heading', { name: /Games ·/ });
    expect(replacement.load).toHaveBeenCalledTimes(2);
    expect(f.props.onSessionExpired).not.toHaveBeenCalled();
  });
});
