import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PrivateRequestError } from '../../client/private-request';
import { SessionExpiredError } from '../../client/events';
import type { PlayerAdmissionStatus } from '../../domain/admission';
import { JoinAccess } from './JoinAccess';
import { admissionId, admissionsClient, deferred, status } from './test-support';

function mount(token: string | null = 'A'.repeat(43), signedIn = true) {
  const props = { client: admissionsClient(), eventId: admissionId(100), inviteId: admissionId(200),
    token: token ?? undefined, signedIn, onSessionExpired: vi.fn(), onClaimed: vi.fn(), onApproved: vi.fn() };
  return { props, ...render(<JoinAccess {...props} />) };
}
describe('caller-bound invitation admission', () => {
  it('uses the single global account control and never reads private APIs before authentication', () => {
    const f = mount(null, false);
    expect(screen.getByText(/Sign in using the button above/)).toBeVisible();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(f.props.client.status).not.toHaveBeenCalled();
    expect(f.props.client.claim).not.toHaveBeenCalled();
    f.rerender(<JoinAccess {...f.props} token={'A'.repeat(43)} />);
    expect(f.props.client.status).not.toHaveBeenCalled();
    expect(f.props.client.claim).not.toHaveBeenCalled();
  });
  it('claims only on explicit request, shows verification and survives parent secret removal without status loops', async () => {
    const f = mount();
    expect(f.props.client.claim).not.toHaveBeenCalled();
    expect(f.props.client.status).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Request access' }));
    expect(await screen.findByText('ABCD-1234')).toBeVisible();
    expect(screen.getByText(/No access has been granted yet/)).toBeVisible();
    expect(f.props.onClaimed).toHaveBeenCalledWith(admissionId(200));
    f.rerender(<JoinAccess {...f.props} token={undefined} />);
    expect(screen.getByText('ABCD-1234')).toBeVisible();
    expect(f.props.client.status).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain('A'.repeat(43));
    expect(screen.queryByDisplayValue('A'.repeat(43))).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Open event overview' })).not.toBeInTheDocument();
    vi.mocked(f.props.client.status).mockResolvedValueOnce(status('approved'));
    await userEvent.click(screen.getByRole('button', { name: 'Check approval' }));
    expect(await screen.findByRole('link', { name: 'Open event overview' })).toHaveAttribute('href', `#overview?event=${admissionId(100)}`);
    expect(screen.getByText(/assigned saved playing group/)).toBeVisible();
    expect(f.props.client.status).toHaveBeenCalledOnce();
    expect(f.props.onApproved).toHaveBeenCalledOnce();
  });
  it('retries an uncertain claim with the original id, without emitting secrets or implying approval', async () => {
    const f = mount();
    vi.mocked(f.props.client.claim).mockRejectedValueOnce(new Error(`Fictional response lost ${'A'.repeat(43)}`));
    await userEvent.click(screen.getByRole('button', { name: 'Request access' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('did not confirm');
    expect(document.body.textContent).not.toContain('A'.repeat(43));
    await userEvent.click(screen.getByRole('button', { name: 'Retry original access request' }));
    await screen.findByText('ABCD-1234');
    const calls = vi.mocked(f.props.client.claim).mock.calls;
    expect(calls[0]?.slice(0, 3)).toEqual(calls[1]?.slice(0, 3));
    expect(calls).toHaveLength(2);
  });
  it('loads one caller-bound status on resume and performs only manual checks', async () => {
    const f = mount(null);
    await screen.findByText('ABCD-1234');
    expect(f.props.client.status).toHaveBeenCalledWith(admissionId(100), admissionId(200), expect.any(AbortSignal));
    expect(f.props.client.status).toHaveBeenCalledOnce();
    expect(f.props.client.claim).not.toHaveBeenCalled();
    vi.mocked(f.props.client.status).mockRejectedValueOnce(new Error('Fictional network failure'));
    await userEvent.click(screen.getByRole('button', { name: 'Check approval' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('did not confirm');
    expect(screen.queryByText('ABCD-1234')).not.toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry status check' }));
    expect(await screen.findByText('ABCD-1234')).toBeVisible();
  });
  it('recovers a failed status refresh after claiming even when the parent retains the token prop', async () => {
    const f = mount();
    await userEvent.click(screen.getByRole('button', { name: 'Request access' }));
    await screen.findByText('ABCD-1234');
    vi.mocked(f.props.client.status).mockRejectedValueOnce(new Error('Fictional unavailable status'));
    await userEvent.click(screen.getByRole('button', { name: 'Check approval' }));
    await screen.findByRole('alert');
    expect(screen.queryByRole('button', { name: 'Request access' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry status check' }));
    expect(await screen.findByText('ABCD-1234')).toBeVisible();
    expect(f.props.client.claim).toHaveBeenCalledOnce();
  });
  it.each(['revoked', 'replaced'] as const)('shows %s status without granting access', async (state) => {
    const f = mount(null);
    vi.mocked(f.props.client.status).mockResolvedValueOnce(status(state));
    // The initial request was started by mounting; use the explicit check for the returned state.
    await screen.findByText('ABCD-1234');
    await userEvent.click(screen.getByRole('button', { name: 'Check approval' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(state === 'revoked' ? 'revoked' : 'replaced');
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
  it.each([
    [new PrivateRequestError(403, 'Wrong fictional account'), false, 'This account does not have access'],
    [new PrivateRequestError(404, 'Missing fictional event'), false, 'unavailable'],
    [new PrivateRequestError(410, 'Expired fictional invitation'), false, 'expired'],
    [new PrivateRequestError(401, 'Fictional expiry'), true, 'Your session expired'],
    [new SessionExpiredError('Fictional session expiry'), true, 'Your session expired'],
  ] as const)('fails closed on %s and expires only actual authentication failure', async (error, expires, message) => {
    const f = mount();
    vi.mocked(f.props.client.claim).mockRejectedValueOnce(error);
    await userEvent.click(screen.getByRole('button', { name: 'Request access' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(screen.queryByRole('button', { name: 'Request access' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(f.props.onSessionExpired).toHaveBeenCalledTimes(expires ? 1 : 0);
    expect(f.props.onClaimed).not.toHaveBeenCalled();
    expect(f.props.onApproved).not.toHaveBeenCalled();
  });
  it('clears private status at sign-out, event/client switches and unmount; ignores stale success/expiry', async () => {
    const f = mount(null);
    await screen.findByText('ABCD-1234');
    const pending = deferred<PlayerAdmissionStatus>();
    vi.mocked(f.props.client.status).mockReturnValueOnce(pending.promise);
    await userEvent.click(screen.getByRole('button', { name: 'Check approval' }));
    const signal = vi.mocked(f.props.client.status).mock.calls.at(-1)?.[2];
    f.rerender(<JoinAccess {...f.props} signedIn={false} />);
    expect(signal?.aborted).toBe(true);
    expect(screen.queryByText('Fictional invitation event')).not.toBeInTheDocument();
    await act(async () => { pending.resolve(status('approved')); await pending.promise; });
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    const next = admissionsClient();
    vi.mocked(next.status).mockReturnValueOnce(deferred<PlayerAdmissionStatus>().promise);
    f.rerender(<JoinAccess {...f.props} client={next} eventId={admissionId(102)} />);
    expect(screen.queryByText('ABCD-1234')).not.toBeInTheDocument();
    f.unmount();
    expect(vi.mocked(next.status).mock.calls[0]?.[2].aborted).toBe(true);
    expect(f.props.onClaimed).not.toHaveBeenCalled();
    expect(f.props.onSessionExpired).not.toHaveBeenCalled();
    expect(f.props.onApproved).not.toHaveBeenCalled();
  });
  it('aborts a late claim on invite switch and never clears the newer invitation secret', async () => {
    const f = mount();
    const pending = deferred<PlayerAdmissionStatus>();
    vi.mocked(f.props.client.claim).mockReturnValueOnce(pending.promise);
    await userEvent.click(screen.getByRole('button', { name: 'Request access' }));
    const signal = vi.mocked(f.props.client.claim).mock.calls[0]?.[3];
    f.rerender(<JoinAccess {...f.props} inviteId={admissionId(201)} />);
    expect(signal?.aborted).toBe(true);
    await act(async () => { pending.resolve(status()); await pending.promise; });
    expect(f.props.onClaimed).not.toHaveBeenCalled();
    expect(f.props.onApproved).not.toHaveBeenCalled();
    expect(screen.queryByText('ABCD-1234')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Request access' })).toBeEnabled();
  });
  it('ignores a late 401 after unmount', async () => {
    const f = mount();
    const pending = deferred<PlayerAdmissionStatus>();
    vi.mocked(f.props.client.claim).mockReturnValueOnce(pending.promise);
    await userEvent.click(screen.getByRole('button', { name: 'Request access' }));
    await waitFor(() => { expect(f.props.client.claim).toHaveBeenCalledOnce(); });
    f.unmount();
    await act(async () => { pending.reject(new SessionExpiredError('Late fictional expiry')); await Promise.resolve(); });
    expect(f.props.onSessionExpired).not.toHaveBeenCalled();
  });
  it('notifies the latest callback once on pending-to-approved, not on callback rerenders or secret removal', async () => {
    const f = mount();
    await userEvent.click(screen.getByRole('button', { name: 'Request access' }));
    await screen.findByText('ABCD-1234');
    expect(f.props.onApproved).not.toHaveBeenCalled();
    const currentCallback = vi.fn();
    f.rerender(<JoinAccess {...f.props} onApproved={currentCallback} />);
    vi.mocked(f.props.client.status).mockResolvedValueOnce(status('approved'));
    await userEvent.click(screen.getByRole('button', { name: 'Check approval' }));
    await screen.findByRole('link', { name: 'Open event overview' });
    expect(currentCallback).toHaveBeenCalledOnce();
    expect(f.props.onApproved).not.toHaveBeenCalled();
    f.rerender(<JoinAccess {...f.props} token={undefined} onApproved={vi.fn()} />);
    expect(currentCallback).toHaveBeenCalledOnce();
    expect(f.props.client.status).toHaveBeenCalledOnce();
  });
  it('notifies once for an already-approved successful claim, preserving the secret-clearing callback', async () => {
    const f = mount();
    vi.mocked(f.props.client.claim).mockResolvedValueOnce(status('approved'));
    await userEvent.click(screen.getByRole('button', { name: 'Request access' }));
    await screen.findByRole('link', { name: 'Open event overview' });
    expect(f.props.onClaimed).toHaveBeenCalledExactlyOnceWith(admissionId(200));
    expect(f.props.onApproved).toHaveBeenCalledOnce();
    f.rerender(<JoinAccess {...f.props} token={undefined} />);
    expect(f.props.onApproved).toHaveBeenCalledOnce();
    expect(f.props.client.status).not.toHaveBeenCalled();
  });
});
