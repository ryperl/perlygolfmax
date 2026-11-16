import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { publicLeaderboardFixture } from '../domain/public-leaderboard.test-support';
import { publicLeaderboardSummary } from '../domain/public-leaderboard';
import type { PublicLeaderboardSummary } from '../domain/public-leaderboard';
import type { PublicLeaderboardClient } from '../client/public-leaderboard';
import { PrivateRequestError } from '../client/private-request';
import { PublicLeaderboardPage } from './PublicLeaderboardPage';

const full = publicLeaderboardFixture(4, 2);
describe('public compact leaderboard lifecycle', () => {
  it('requests the selected board only, recovers explicit quota failure and never exposes owner controls', async () => {
    const load = vi.fn<PublicLeaderboardClient['load']>().mockImplementation((_event, _signal, kind = 'overall') =>
      Promise.resolve(publicLeaderboardSummary(full, kind)));
    const props = { client: { load }, eventId: full.workspace.event.id, eventSkins: false, onSessionExpired: vi.fn() };
    const view = render(<PublicLeaderboardPage {...props} />);
    await screen.findByRole('table');
    expect(load).toHaveBeenLastCalledWith(props.eventId, expect.any(AbortSignal), 'overall');
    load.mockRejectedValueOnce(new PrivateRequestError(429, 'Fictional throttle'));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh overall results' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Fictional throttle');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh overall results' }));
    await screen.findByRole('table');
    view.rerender(<PublicLeaderboardPage {...props} eventSkins />);
    await screen.findByRole('heading', { name: /Event-wide skins/ });
    expect(load).toHaveBeenLastCalledWith(props.eventId, expect.any(AbortSignal), 'event-skins');
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });
  it('aborts replaced requests and ignores late results for another board', async () => {
    let resolve: ((value: PublicLeaderboardSummary) => void) | undefined;
    const load = vi.fn<PublicLeaderboardClient['load']>().mockReturnValueOnce(new Promise((complete) => { resolve = complete; }))
      .mockResolvedValue(publicLeaderboardSummary(full, 'event-skins'));
    const props = { client: { load }, eventId: full.workspace.event.id, onSessionExpired: vi.fn() };
    const view = render(<PublicLeaderboardPage {...props} eventSkins={false} />);
    view.rerender(<PublicLeaderboardPage {...props} eventSkins />);
    await screen.findByRole('heading', { name: /Event-wide skins/ });
    expect(load.mock.calls[0]?.[1].aborted).toBe(true);
    await act(async () => { resolve?.(publicLeaderboardSummary(full, 'overall')); await Promise.resolve(); });
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    view.unmount();
    await waitFor(() => { expect(load.mock.calls[1]?.[1].aborted).toBe(true); });
  });
});
