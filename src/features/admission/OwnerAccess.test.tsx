import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { generateInvitationSecret } from '../../client/admission';
import type * as AdmissionModule from '../../client/admission';
import { EventChangedError, SessionExpiredError } from '../../client/events';
import { PrivateRequestError } from '../../client/private-request';
import type { AdmissionManagement, AdmissionResult } from '../../domain/admission';
import { OwnerAccess } from './OwnerAccess';
import { admissionId, admissionsClient, deferred, invitation, management } from './test-support';

vi.mock('../../client/admission', async (original) => {
  const actual = await original<typeof AdmissionModule>();
  return { ...actual, generateInvitationSecret: vi.fn() };
});

beforeEach(() => {
  vi.mocked(generateInvitationSecret).mockResolvedValue({ token: 'A'.repeat(43), tokenHash: 'a'.repeat(64) });
});
function mount(value = management()) {
  const props = { client: admissionsClient(value), eventId: value.eventId, onSessionExpired: vi.fn() };
  return { props, ...render(<OwnerAccess {...props} />) };
}
async function selectFirst() {
  await screen.findByRole('combobox', { name: 'Saved roster golfer' });
  await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Saved roster golfer' }), admissionId(1));
}
describe('owner invitation management', () => {
  it('creates only a digest request at the current etag; displays the private share field only after an open acknowledgment', async () => {
    const f = mount();
    await selectFirst();
    const pending = deferred<AdmissionResult>();
    vi.mocked(f.props.client.invite).mockReturnValueOnce(pending.promise);
    await userEvent.click(screen.getByRole('button', { name: 'Create private invitation link' }));
    await waitFor(() => { expect(f.props.client.invite).toHaveBeenCalledOnce(); });
    expect(screen.queryByLabelText('Private share link')).not.toBeInTheDocument();
    const call = vi.mocked(f.props.client.invite).mock.calls[0];
    if (!call) throw new Error('Missing fictional call.');
    expect(call[1].playerId).toBe(admissionId(1));
    expect(call[1].tokenHash).toBe('a'.repeat(64));
    expect(call[1].inviteId).toMatch(/^[a-f0-9-]{36}$/);
    expect(call[2]).toBe('"fictional-event-v1"');
    expect(JSON.stringify(call[1])).not.toContain('A'.repeat(43));
    await act(async () => { pending.resolve({ operationId: call[3], inviteId: call[1].inviteId, state: 'open' }); await pending.promise; });
    expect(await screen.findByLabelText('Private share link')).toHaveAttribute('type', 'password');
    expect(document.body.textContent).not.toContain('A'.repeat(43));
    expect(screen.getByLabelText('Private share link')).toHaveValue(
      `http://localhost:3000/#join?event=${admissionId(100)}&invite=${call[1].inviteId}&token=${'A'.repeat(43)}`);
    expect(screen.getByText(/Nothing is emailed/)).toBeVisible();
    f.unmount();
    render(<OwnerAccess {...f.props} />);
    await selectFirst();
    expect(screen.queryByLabelText('Private share link')).not.toBeInTheDocument();
  });
  it('handles clipboard failure explicitly and provides a selectable manual copy fallback', async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValueOnce(new Error('Fictional denied clipboard'));
    mount();
    await selectFirst();
    await user.click(screen.getByRole('button', { name: 'Create private invitation link' }));
    await screen.findByLabelText('Private share link');
    await user.click(screen.getByRole('button', { name: 'Copy private invitation link' }));
    expect(await screen.findByText(/Copy failed/)).toBeVisible();
    const field = screen.getByLabelText('Private share link');
    field.focus();
    expect(field).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Copy private invitation link' }));
    expect(await screen.findByText('Private link copied.')).toBeVisible();
  });
  it('retains the exact invitation id, token, etag and request id through an uncertain retry', async () => {
    const f = mount();
    await selectFirst();
    vi.mocked(f.props.client.invite).mockRejectedValueOnce(new Error('Fictional disconnected response'));
    await userEvent.click(screen.getByRole('button', { name: 'Create private invitation link' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Retry original attempt' }));
    const calls = vi.mocked(f.props.client.invite).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0]?.slice(0, 4)).toEqual(calls[1]?.slice(0, 4));
    expect(generateInvitationSecret).toHaveBeenCalledOnce();
    const field = await screen.findByLabelText('Private share link');
    expect(field).toBeInstanceOf(HTMLInputElement);
    if (!(field instanceof HTMLInputElement)) throw new Error('Missing private link input.');
    expect(field.value).toContain('A'.repeat(43));
  });
  it('requires explicit replacement after reload and refresh/review on conflict, without silently rebasing', async () => {
    const f = mount(management([invitation('pending')]));
    await selectFirst();
    vi.mocked(f.props.client.invite).mockRejectedValueOnce(new EventChangedError('Fictional conflict'));
    await userEvent.click(screen.getByRole('button', { name: 'Replace old invitation and create new link' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Refresh and review');
    expect(screen.queryByRole('button', { name: 'Retry original attempt' })).not.toBeInTheDocument();
    expect(vi.mocked(f.props.client.invite).mock.calls[0]?.[1].replaceInviteId).toBe(admissionId(200));
    vi.mocked(f.props.client.list).mockResolvedValueOnce({ ...management([invitation('open')]), etag: '"fictional-event-v2"' });
    await userEvent.click(screen.getByRole('button', { name: 'Refresh and review changed invitations' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Replace old invitation and create new link' })).toBeEnabled());
    await userEvent.click(screen.getByRole('button', { name: 'Replace old invitation and create new link' }));
    expect(vi.mocked(f.props.client.invite).mock.calls[1]?.[2]).toBe('"fictional-event-v2"');
  });
  it('requires a valid human code and explicit all-events confirmation; preserves the code on rejection', async () => {
    const f = mount(management([invitation('pending')]));
    vi.mocked(f.props.client.list).mockResolvedValueOnce({ ...management([invitation('pending')]), etag: '"fictional-event-v2"' });
    await screen.findByLabelText('Verification code from Fictional golfer 1');
    await userEvent.click(screen.getByRole('button', { name: 'Refresh player access' }));
    await waitFor(() => { expect(screen.getByRole('button', { name: 'Refresh player access' })).toBeEnabled(); });
    const code = await screen.findByLabelText('Verification code from Fictional golfer 1');
    const approve = screen.getByRole('button', { name: 'Approve Fictional golfer 1' });
    expect(approve).toBeDisabled();
    await userEvent.type(code, 'wrong');
    await userEvent.click(screen.getByRole('checkbox'));
    expect(approve).toBeDisabled();
    await userEvent.clear(code);
    await userEvent.type(code, 'ffff-1234');
    vi.mocked(f.props.client.approve).mockRejectedValueOnce(new PrivateRequestError(400, 'Wrong fictional code'));
    await userEvent.click(approve);
    expect(await screen.findByRole('alert')).toHaveTextContent('Check the verification code');
    expect(code).toHaveValue('FFFF-1234');
    expect(screen.queryByText('Player admission approved.')).not.toBeInTheDocument();
    await userEvent.clear(code); await userEvent.type(code, 'abcd-1234');
    await userEvent.click(approve);
    expect(await screen.findByText('Player admission approved.')).toBeVisible();
    const call = vi.mocked(f.props.client.approve).mock.calls.at(-1);
    expect(call?.[1]).toEqual({ inviteId: admissionId(200), revision: admissionId(300), verificationCode: 'ABCD-1234' });
    expect(call?.[2]).toBe('"fictional-event-v2"');
  });
  it('preserves scores when revoking and allows only security revocation on archived events', async () => {
    const f = mount({ ...management([invitation('approved')]), eventStatus: 'archived' });
    await screen.findByText(/This event is archived/);
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Approve/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Revoke event admission for Fictional golfer 1' }));
    expect(await screen.findByText('This event admission was revoked. Saved scores are preserved.')).toBeVisible();
    expect(f.props.client.revoke).toHaveBeenCalledWith(admissionId(100), { inviteId: admissionId(200), revision: admissionId(300) },
      '"fictional-event-v1"', expect.any(String), expect.any(AbortSignal));
    expect(screen.getByText(/Other approved admissions can still grant/)).toBeVisible();
  });
  it('hides approval for pending invitations on archived events but keeps revocation', async () => {
    mount({ ...management([invitation('pending')]), eventStatus: 'archived' });
    await screen.findByText(/This event is archived/);
    expect(screen.queryByLabelText('Verification code from Fictional golfer 1')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve Fictional golfer 1' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Revoke invitation for Fictional golfer 1' })).toBeEnabled();
  });
  it('retains an uncertain approval verbatim and never reports approval after an API error', async () => {
    const f = mount(management([invitation('pending')]));
    await userEvent.type(await screen.findByLabelText('Verification code from Fictional golfer 1'), 'ABCD-1234');
    await userEvent.click(screen.getByRole('checkbox'));
    vi.mocked(f.props.client.approve).mockRejectedValueOnce(new Error('Fictional lost approval response'));
    await userEvent.click(screen.getByRole('button', { name: 'Approve Fictional golfer 1' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('did not confirm');
    expect(screen.queryByText('Player admission approved.')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Verification code from Fictional golfer 1')).toHaveValue('ABCD-1234');
    await userEvent.click(screen.getByRole('button', { name: 'Retry original attempt' }));
    const calls = vi.mocked(f.props.client.approve).mock.calls;
    expect(calls[0]?.slice(0, 4)).toEqual(calls[1]?.slice(0, 4));
    expect(await screen.findByText('Player admission approved.')).toBeVisible();
  });
  it('aborts late invitation acknowledgments at a client switch, never exposing the old link', async () => {
    const f = mount();
    await selectFirst();
    const pending = deferred<AdmissionResult>();
    vi.mocked(f.props.client.invite).mockReturnValueOnce(pending.promise);
    await userEvent.click(screen.getByRole('button', { name: 'Create private invitation link' }));
    const call = vi.mocked(f.props.client.invite).mock.calls[0];
    if (!call) throw new Error('Missing fictional invitation attempt.');
    const next = admissionsClient(management([], 0));
    f.rerender(<OwnerAccess {...f.props} client={next} />);
    expect(call[4].aborted).toBe(true);
    await act(async () => {
      pending.resolve({ operationId: call[3], inviteId: call[1].inviteId, state: 'open' });
      await pending.promise;
    });
    expect(screen.queryByLabelText('Private share link')).not.toBeInTheDocument();
    expect(screen.queryByText(/Invitation created/)).not.toBeInTheDocument();
  });
  it('searches and pages the full roster without dropping a selected golfer', async () => {
    mount(management([], 125));
    await selectFirst();
    await userEvent.click(screen.getByRole('button', { name: 'Next golfers' }));
    expect(screen.getByRole('option', { name: 'Fictional golfer 21' })).toBeInTheDocument();
    expect(screen.getByText('Selected: Fictional golfer 1')).toBeVisible();
    await userEvent.type(screen.getByLabelText('Find saved roster golfer'), '125');
    await userEvent.selectOptions(screen.getByLabelText('Saved roster golfer'), admissionId(125));
    await userEvent.click(screen.getByRole('button', { name: 'Create private invitation link' }));
    expect(await screen.findByLabelText('Private share link')).toBeVisible();
  });
  it.each([
    [new PrivateRequestError(401, 'Fictional expired'), true],
    [new SessionExpiredError('Fictional expired'), true],
    [new PrivateRequestError(403, 'Fictional denied'), false],
    [new PrivateRequestError(404, 'Fictional missing'), false],
  ] as const)('clears private data and secrets on %s; only real expiry invokes the callback', async (error, expires) => {
    const f = mount();
    await selectFirst();
    await userEvent.click(screen.getByRole('button', { name: 'Create private invitation link' }));
    await screen.findByLabelText('Private share link');
    vi.mocked(f.props.client.list).mockRejectedValueOnce(error);
    await userEvent.click(screen.getByRole('button', { name: 'Refresh player access' }));
    await screen.findByRole('alert');
    expect(screen.queryByLabelText('Private share link')).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(f.props.onSessionExpired).toHaveBeenCalledTimes(expires ? 1 : 0);
  });
  it('aborts event/client switches and unmounts and ignores late private responses', async () => {
    const f = mount();
    await selectFirst();
    const old = deferred<AdmissionManagement>();
    vi.mocked(f.props.client.list).mockReturnValueOnce(old.promise);
    await userEvent.click(screen.getByRole('button', { name: 'Refresh player access' }));
    const oldSignal = vi.mocked(f.props.client.list).mock.calls.at(-1)?.[1];
    const next = admissionsClient({ ...management(), eventId: admissionId(101), roster: [] });
    f.rerender(<OwnerAccess {...f.props} client={next} eventId={admissionId(101)} />);
    expect(oldSignal?.aborted).toBe(true);
    expect(screen.queryByText('Selected: Fictional golfer 1')).not.toBeInTheDocument();
    await act(async () => { old.resolve(management([invitation()])); await old.promise; });
    expect(screen.queryByRole('heading', { name: 'Fictional golfer 1' })).not.toBeInTheDocument();
    const pending = deferred<AdmissionManagement>();
    vi.mocked(next.list).mockReturnValueOnce(pending.promise);
    await userEvent.click(screen.getByRole('button', { name: 'Refresh player access' }));
    f.unmount();
    expect(vi.mocked(next.list).mock.calls.at(-1)?.[1].aborted).toBe(true);
    await act(async () => { pending.reject(new SessionExpiredError('Late fictional expiry')); await Promise.resolve(); });
    expect(f.props.onSessionExpired).not.toHaveBeenCalled();
  });
});
