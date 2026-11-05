import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { AdmissionsClient } from '../../client/admission';
import { generateInvitationSecret, invitationUrl } from '../../client/admission';
import { isVerificationCode } from '../../contracts/admission';
import type { AdmissionManagement, ApproveInvitation, CreateInvitation, ManageInvitation, PlayerInvitation } from '../../domain/admission';
import { AccessPolicy } from './AccessPolicy';
import { admissionFailure } from './shared';
import './admission.css';

export interface OwnerAccessProps {
  readonly client: AdmissionsClient;
  readonly eventId: string;
  readonly onSessionExpired: (message: string) => void;
}
type Attempt = { readonly etag: string; readonly requestId: string } & (
  | { readonly kind: 'invite'; readonly input: CreateInvitation; readonly url: string }
  | { readonly kind: 'approve'; readonly input: ApproveInvitation }
  | { readonly kind: 'revoke'; readonly input: ManageInvitation }
);

export function OwnerAccess(props: OwnerAccessProps) {
  const identity = useMemo(() => ({ key: crypto.randomUUID(), client: props.client, eventId: props.eventId }), [props.client, props.eventId]);
  return <OwnerAccessSession key={identity.key} {...props} />;
}

function OwnerAccessSession({ client, eventId, onSessionExpired }: OwnerAccessProps) {
  const [value, setValue] = useState<AdmissionManagement>();
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState<Attempt>();
  const [conflict, setConflict] = useState(false);
  const [link, setLink] = useState('');
  const [copied, setCopied] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [playerId, setPlayerId] = useState('');
  const [codes, setCodes] = useState<Readonly<Record<string, string>>>({});
  const [confirmed, setConfirmed] = useState<Readonly<Record<string, boolean>>>({});
  const request = useRef<AbortController | null>(null);
  const alive = useRef(true);
  const copyEpoch = useRef(0);
  const expiry = useRef(onSessionExpired);
  useLayoutEffect(() => { expiry.current = onSessionExpired; }, [onSessionExpired]);
  useLayoutEffect(() => { copyEpoch.current += 1; }, [link]);
  function isCurrent(controller: AbortController): boolean {
    return alive.current && !controller.signal.aborted;
  }

  function fail(error: unknown) {
    const failure = admissionFailure(error);
    setError(failure.message);
    if (failure.denied) {
      setValue(undefined); setAttempt(undefined); setLink(''); setCodes({}); setConfirmed({});
      setPlayerId(''); setSearch(''); setNotice(''); setCopied('');
    } else if (failure.conflict) {
      setConflict(true); setLink(''); setCopied('');
    } else if (failure.definitive) setAttempt(undefined);
    if (failure.expired) expiry.current(failure.message);
  }
  async function load() {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller; setBusy(true); setError('');
    try {
      const next = await client.list(eventId, controller.signal);
      if (!isCurrent(controller)) return;
      setValue(next); setAttempt(undefined); setConflict(false); setLink(''); setCopied(''); setNotice('');
    } catch (error) {
      if (alive.current && !controller.signal.aborted) fail(error);
    } finally {
      if (request.current === controller) request.current = null;
      if (alive.current && !controller.signal.aborted) setBusy(false);
    }
  }
  useLayoutEffect(() => {
    alive.current = true;
    void load();
    return () => { alive.current = false; request.current?.abort(); request.current = null; };
    // This controller is remounted by the app boundary for each event/client.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submit(next: Attempt, controller: AbortController) {
    setAttempt(next);
    const result = next.kind === 'invite'
      ? await client.invite(eventId, next.input, next.etag, next.requestId, controller.signal)
      : next.kind === 'approve'
        ? await client.approve(eventId, next.input, next.etag, next.requestId, controller.signal)
        : await client.revoke(eventId, next.input, next.etag, next.requestId, controller.signal);
    if (!alive.current || controller.signal.aborted) return;
    const expected = next.kind === 'invite' ? 'open' : next.kind === 'approve' ? 'approved' : 'revoked';
    if (result.state !== expected || result.inviteId !== next.input.inviteId || result.operationId !== next.requestId) {
      throw new Error('Unconfirmed operation.');
    }
    setAttempt(undefined);
    setLink(next.kind === 'invite' ? next.url : '');
    setCopied('');
    setNotice(next.kind === 'invite' ? 'Invitation created. Copy the private link below and share it yourself.'
      : next.kind === 'approve' ? 'Player admission approved.' : 'This event admission was revoked. Saved scores are preserved.');
    const updated = await client.list(eventId, controller.signal);
    if (isCurrent(controller)) setValue(updated);
  }
  async function run(create: () => Promise<Attempt>) {
    if (request.current || conflict) return;
    const controller = new AbortController();
    request.current = controller; setBusy(true); setError('');
    try {
      const next = await create();
      if (!alive.current || controller.signal.aborted) return;
      await submit(next, controller);
    } catch (error) {
      if (alive.current && !controller.signal.aborted) fail(error);
    } finally {
      if (request.current === controller) request.current = null;
      if (alive.current && !controller.signal.aborted) setBusy(false);
    }
  }
  function createInvitation(replace?: PlayerInvitation) {
    if (!value || value.eventStatus === 'archived' || !playerId || attempt) return;
    void run(async () => {
      const secret = await generateInvitationSecret();
      const input: CreateInvitation = {
        inviteId: crypto.randomUUID(), playerId, tokenHash: secret.tokenHash,
        ...(replace ? { replaceInviteId: replace.inviteId } : {}),
      };
      return { kind: 'invite', input, etag: value.etag, requestId: crypto.randomUUID(),
        url: invitationUrl(window.location.href, { eventId, inviteId: input.inviteId, token: secret.token }) };
    });
  }
  async function copy() {
    const original = link;
    const epoch = copyEpoch.current;
    setCopied('');
    try {
      if (typeof navigator.clipboard === 'undefined') throw new Error('Clipboard unavailable.');
      await navigator.clipboard.writeText(original);
      if (alive.current && epoch === copyEpoch.current) setCopied('Private link copied.');
    } catch {
      if (alive.current && epoch === copyEpoch.current) setCopied('Copy failed. Select the private link field and copy it manually.');
    }
  }
  const filtered = value?.roster.filter((player) => player.displayName.toLocaleLowerCase().includes(search.toLocaleLowerCase())) ?? [];
  const players = filtered.slice(page * 20, (page + 1) * 20);
  const existing = value?.invitations.find((invite) => invite.playerId === playerId && ['open', 'pending', 'approved'].includes(invite.state));
  const locked = busy || !!attempt || conflict;
  return <section className="admission-panel" aria-label="Player access">
    <h1>Player access</h1>
    <AccessPolicy />
    <p>Links expire after 24 hours. An approved membership does not expire when its invitation link expires.
      Nothing is emailed or messaged automatically.</p>
    <button disabled={busy || !!attempt && !conflict} onClick={() => { void load(); }}>
      {conflict ? 'Refresh and review changed invitations' : 'Refresh player access'}
    </button>
    {busy && <p role="status">Updating player access…</p>}
    {error && <p role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {attempt && !conflict && <div>
      <p>The original attempt is retained privately. Retry it without changing its inputs.</p>
      <button disabled={busy} onClick={() => { void run(() => Promise.resolve(attempt)); }}>Retry original attempt</button>
    </div>}
    {link && <div className="admission-controls">
      <label>Private share link<input type="password" readOnly value={link} autoComplete="off"
        onFocus={(event) => { event.currentTarget.select(); }} /></label>
      <button onClick={() => { void copy(); }}>Copy private invitation link</button>
      <p>Keep this link private. Select the field to copy manually if needed. It cannot be recovered after reloading.</p>
      {copied && <p role="status">{copied}</p>}
    </div>}
    {value && <>
      {value.eventStatus === 'archived' ? <p>This event is archived. New invitations and approvals are disabled. Security revocation remains available.</p>
        : <form onSubmit={(event) => { event.preventDefault(); createInvitation(existing); }}>
          <label>Find saved roster golfer<input value={search} disabled={locked}
            onChange={(event) => { setSearch(event.target.value); setPage(0); }} /></label>
          <label>Saved roster golfer<select value={players.some((player) => player.playerId === playerId) ? playerId : ''}
            disabled={locked} onChange={(event) => { setPlayerId(event.target.value); }}>
            <option value="">Choose a golfer</option>
            {players.map((player) => <option key={player.playerId} value={player.playerId}>{player.displayName}</option>)}
          </select></label>
          {playerId && <p>Selected: {value.roster.find((player) => player.playerId === playerId)?.displayName}</p>}
          <div className="event-actions">
            <button type="button" disabled={locked || page === 0} onClick={() => { setPage(page - 1); }}>Previous golfers</button>
            <button type="button" disabled={locked || (page + 1) * 20 >= filtered.length} onClick={() => { setPage(page + 1); }}>Next golfers</button>
          </div>
          <p>{filtered.length} matching saved golfers. Search and paging do not remove your selection.</p>
          {existing?.state === 'approved' ? <p>This golfer already has an approved admission. Revoke that admission explicitly if needed.</p>
            : <><p>{existing ? 'Replacing invalidates the old open or pending invitation, including its pending request. Share the new link yourself.' : 'Choose a saved roster golfer; no email matching is used.'}</p>
              <button disabled={locked || !playerId} type="submit">{existing ? 'Replace old invitation and create new link' : 'Create private invitation link'}</button></>}
        </form>}
      <h2>Saved invitations</h2>
      <p>Raw links cannot be recovered on reload. Explicitly replace an open or pending invitation to get a new link.</p>
      {value.invitations.length === 0 && <p>No invitations yet.</p>}
      <ul>{value.invitations.map((invite) => <li key={invite.inviteId}>
        <h3>{invite.displayName}</h3><p>Status: {invite.state}</p>
        {invite.state === 'pending' && value.eventStatus === 'active' && <div className="admission-controls">
          <label>Verification code from {invite.displayName}
            <input value={codes[invite.inviteId] ?? ''} disabled={locked} placeholder="ABCD-1234" autoComplete="off"
              onChange={(event) => { setCodes({ ...codes, [invite.inviteId]: event.target.value.toUpperCase() }); }} />
          </label>
          <p>Ask the player to read their code to you. Verify their identity yourself; sign-in alone is not admission.</p>
          <label><span><input type="checkbox" checked={confirmed[invite.inviteId] ?? false} disabled={locked}
            onChange={(event) => { setConfirmed({ ...confirmed, [invite.inviteId]: event.target.checked }); }} />
            I verified this player and confirm viewing access to all active events.</span></label>
          <button disabled={locked || !confirmed[invite.inviteId] || !isVerificationCode(codes[invite.inviteId])}
            onClick={() => { void run(() => Promise.resolve({ kind: 'approve', etag: value.etag, requestId: crypto.randomUUID(),
              input: { inviteId: invite.inviteId, revision: invite.revision, verificationCode: codes[invite.inviteId] ?? '' } })); }}>
            Approve {invite.displayName}
          </button>
        </div>}
        {['open', 'pending', 'approved'].includes(invite.state) && <button disabled={locked}
          onClick={() => { void run(() => Promise.resolve({ kind: 'revoke', etag: value.etag, requestId: crypto.randomUUID(),
            input: { inviteId: invite.inviteId, revision: invite.revision } })); }}>
          {invite.state === 'approved' ? 'Revoke event admission for' : 'Revoke invitation for'} {invite.displayName}
        </button>}
      </li>)}</ul>
      <p>Revoking an event admission preserves saved scores. Other approved admissions can still grant general read-only visibility of active events.</p>
    </>}
  </section>;
}
