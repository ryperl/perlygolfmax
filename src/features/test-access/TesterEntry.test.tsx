import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SessionExpiredError } from '../../client/events';
import type { EventWorkspace } from '../../domain/setup';
import { TesterEntry } from './TesterEntry';
import { credential, deferred, testerClient, testerLink, workspace } from './test-support';

describe('no-account tester entry', () => {
  it('sorts round choices chronologically without resetting the selected round or score read', async () => {
    const { client, scores } = testerClient();
    const first = workspace.rounds[0];
    if (!first) throw new Error('Missing fictional round.');
    vi.mocked(client.workspace).mockResolvedValue({ ...workspace, rounds: [
      { ...first, startDate: '2026-11-08' },
      { ...first, id: testerLink.revision, name: 'Fictional earlier round', startDate: '2026-11-07' },
    ] });
    render(<TesterEntry client={client} credential={credential} onExit={vi.fn()} />);
    const selector = await screen.findByLabelText('Saved round');
    expect(within(selector).getAllByRole('option').map((option) => option.textContent)).toEqual(['Fictional earlier round', first.name]);
    expect(selector).toHaveValue(first.id);
    await waitFor(() => { expect(scores.load).toHaveBeenLastCalledWith(credential.eventId, first.id, expect.any(AbortSignal)); });
  });
  it('loads only the scoped workspace, selects saved rounds, and offers no login or management navigation', async () => {
    const { client, scores } = testerClient();
    const first = workspace.rounds[0];
    if (!first) throw new Error('Missing fictional round');
    vi.mocked(client.workspace).mockResolvedValue({ ...workspace,
      rounds: [first, { ...first, id: testerLink.revision, name: 'Fictional second round' }] });
    const onExit = vi.fn();
    render(<TesterEntry client={client} credential={credential} onExit={onExit} />);
    await screen.findByRole('heading', { name: 'Round scorecard' });
    expect(client.workspace).toHaveBeenCalledWith(credential, expect.any(AbortSignal));
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /sign in|setup|purse|history/i })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Saved round'), { target: { value: testerLink.revision } });
    await waitFor(() => { expect(scores.load).toHaveBeenLastCalledWith(credential.eventId, testerLink.revision, expect.any(AbortSignal)); });
    fireEvent.click(screen.getByRole('button', { name: 'Games' }));
    expect(await screen.findByText(/Settings are read-only/)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Add game' })).not.toBeInTheDocument();
    expect(scores.history).not.toHaveBeenCalled();
    expect(scores.saveGames).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Exit tester access' }));
    expect(onExit).toHaveBeenCalledOnce();
  });

  it('allows score entry for any saved playing group without an account/player binding', async () => {
    const { client, scores } = testerClient();
    render(<TesterEntry client={client} credential={credential} onExit={vi.fn()} />);
    await screen.findByRole('heading', { name: 'Round scorecard' });
    fireEvent.click(screen.getByRole('button', { name: 'Enter scores' }));
    expect(screen.getByLabelText('View group')).toHaveValue('1');
    fireEvent.change(screen.getByLabelText('View group'), { target: { value: '2' } });
    const input = screen.getByRole('textbox', { name: 'Fictional Player 2 score' });
    expect(input).toBeEnabled();
    fireEvent.change(input, { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => { expect(scores.save).toHaveBeenCalledTimes(1); });
    expect(vi.mocked(scores.save).mock.calls[0]?.[2]).toBe(workspace.roster[1]?.playerId);
    await screen.findByText(/1 player changes acknowledged/);
    fireEvent.click(screen.getByRole('button', { name: 'Games' }));
    expect(screen.getByText(/Settings are read-only/)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Add game' })).not.toBeInTheDocument();
  });

  it('shows an honest setup-needed state when there are no saved rounds', async () => {
    const { client, scores } = testerClient();
    vi.mocked(client.workspace).mockResolvedValue({ ...workspace, rounds: [] });
    render(<TesterEntry client={client} credential={credential} onExit={vi.fn()} />);
    await screen.findByText(/organizer needs to save a round and playing groups/);
    expect(screen.queryByLabelText('Saved round')).not.toBeInTheDocument();
    expect(scores.load).not.toHaveBeenCalled();
  });

  it('clears event labels, private cards and drafts on score-service access loss without asking for sign-in', async () => {
    const { client, scores } = testerClient();
    render(<TesterEntry client={client} credential={credential} onExit={vi.fn()} />);
    await screen.findByRole('heading', { name: 'Round scorecard' });
    fireEvent.click(screen.getByRole('button', { name: 'Enter scores' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Fictional Player 1 score' }), { target: { value: '8' } });
    vi.mocked(scores.load).mockRejectedValueOnce(new SessionExpiredError('Link revoked'));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh saved round' }));
    await screen.findByText(/Ask the organizer for a fresh private link/);
    expect(screen.queryByRole('heading', { name: workspace.event.name })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByText(/sign in again/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Saved round')).not.toBeInTheDocument();
  });

  it('does not expose archived, foreign or non-tester workspace data', async () => {
    for (const invalid of [
      { ...workspace, event: { ...workspace.event, status: 'archived' as const } },
      { ...workspace, event: { ...workspace.event, id: testerLink.linkId } },
      { ...workspace, event: { ...workspace.event, role: 'owner' as const } },
    ]) {
      const { client, scores } = testerClient();
      vi.mocked(client.workspace).mockResolvedValue(invalid);
      const rendered = render(<TesterEntry client={client} credential={credential} onExit={vi.fn()} />);
      await screen.findByRole('alert');
      expect(screen.queryByText(workspace.event.name)).not.toBeInTheDocument();
      expect(scores.load).not.toHaveBeenCalled();
      rendered.unmount();
    }
  });

  it('aborts credential-specific requests and suppresses late workspace data on link changes', async () => {
    const { client } = testerClient();
    const pending = deferred<EventWorkspace>();
    vi.mocked(client.workspace).mockReturnValueOnce(pending.promise);
    const { rerender } = render(<TesterEntry client={client} credential={credential} onExit={vi.fn()} />);
    const signal = vi.mocked(client.workspace).mock.calls[0]?.[1];
    const next = { ...credential, token: 'B'.repeat(43) };
    vi.mocked(client.workspace).mockRejectedValueOnce(new SessionExpiredError('Revoked'));
    rerender(<TesterEntry client={client} credential={next} onExit={vi.fn()} />);
    expect(signal?.aborted).toBe(true);
    await act(async () => { pending.resolve(workspace); await pending.promise; });
    await screen.findByRole('alert');
    expect(screen.queryByText(workspace.event.name)).not.toBeInTheDocument();
  });
});
