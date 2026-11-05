import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { TesterAccessClient } from '../../client/test-access';
import { generateTesterSecret, testerUrl } from '../../client/test-access';
import { EventChangedError, SessionExpiredError } from '../../client/events';
import { PrivateRequestError } from '../../client/private-request';
import type { CreateTesterLink, RevokeTesterLink, TesterAccessManagement, TesterLink } from '../../domain/test-access';
import './test-access.css';

export interface TesterLinksProps {
  readonly client: TesterAccessClient;
  readonly eventId: string;
  readonly onSessionExpired: (message: string) => void;
}

type Attempt = { readonly etag: string; readonly requestId: string } & (
  | { readonly kind: 'create'; readonly input: CreateTesterLink; readonly url: string }
  | { readonly kind: 'revoke'; readonly input: RevokeTesterLink }
);

export function TesterLinks(props: TesterLinksProps) {
  const identity = useMemo(() => ({ key: crypto.randomUUID(), client: props.client, eventId: props.eventId }), [props.client, props.eventId]);
  return <TesterLinksSession key={identity.key} {...props} />;
}

function TesterLinksSession({ client, eventId, onSessionExpired }: TesterLinksProps) {
  const [value, setValue] = useState<TesterAccessManagement>();
  const [attempt, setAttempt] = useState<Attempt>();
  const [conflict, setConflict] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [share, setShare] = useState<{ readonly linkId: string; readonly url: string }>();
  const [copied, setCopied] = useState('');
  const request = useRef<AbortController | null>(null);
  const alive = useRef(false);
  const expiry = useRef(onSessionExpired);
  const shareNow = useRef(share);
  useLayoutEffect(() => { expiry.current = onSessionExpired; }, [onSessionExpired]);
  useLayoutEffect(() => { shareNow.current = share; }, [share]);
  function isCurrent(controller: AbortController): boolean {
    return alive.current && !controller.signal.aborted;
  }

  function fail(failure: unknown) {
    const status = failure instanceof PrivateRequestError ? failure.status : undefined;
    if (failure instanceof SessionExpiredError || status === 401 || status === 403 || status === 404) {
      setValue(undefined); setAttempt(undefined); setShare(undefined); setNotice(''); setCopied('');
      setError('Owner access is unavailable. Sign in with the event owner account.');
      if (failure instanceof SessionExpiredError || status === 401) expiry.current('Your session expired. Sign in again.');
    } else if (failure instanceof EventChangedError || status === 409 || status === 412) {
      setConflict(true); setShare(undefined); setCopied(''); setNotice('');
      setError('The event or tester link changed. Refresh and review before making a new attempt.');
    } else {
      const definitive = status !== undefined && status >= 400 && status < 500 && ![408, 429].includes(status);
      if (definitive) setAttempt(undefined);
      setError(definitive ? 'The request was not accepted. Refresh and review before trying again.'
        : 'The service did not confirm the operation. Do not assume it succeeded. Retry the original attempt if one is retained.');
    }
  }
  async function load() {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller; setBusy(true); setError('');
    try {
      const next = await client.list(eventId, controller.signal);
      if (!isCurrent(controller)) return;
      setValue(next); setAttempt(undefined); setConflict(false); setShare(undefined); setCopied(''); setNotice('');
    } catch (failure) {
      if (isCurrent(controller)) fail(failure);
    } finally {
      if (request.current === controller) request.current = null;
      if (isCurrent(controller)) setBusy(false);
    }
  }
  useLayoutEffect(() => {
    alive.current = true;
    void load();
    return () => { alive.current = false; request.current?.abort(); request.current = null; };
    // The boundary remounts this controller whenever client or event changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function run(make: () => Promise<Attempt>) {
    if (request.current || conflict) return;
    const controller = new AbortController();
    request.current = controller; setBusy(true); setError(''); setNotice(''); setCopied('');
    try {
      const next = await make();
      if (!isCurrent(controller)) return;
      setAttempt(next);
      const result = next.kind === 'create'
        ? await client.create(eventId, next.input, next.etag, next.requestId, controller.signal)
        : await client.revoke(eventId, next.input, next.etag, next.requestId, controller.signal);
      if (!isCurrent(controller)) return;
      if (result.operationId !== next.requestId || result.linkId !== next.input.linkId
        || result.state !== (next.kind === 'create' ? 'active' : 'revoked')) throw new Error('Unconfirmed operation.');
      setAttempt(undefined);
      if (next.kind === 'create') {
        setShare({ linkId: next.input.linkId, url: next.url });
        setNotice('Tester link created. Copy the private link and share it yourself.');
      } else {
        if (shareNow.current?.linkId === next.input.linkId) setShare(undefined);
        setNotice('Tester link revoked. Saved scores are preserved.');
      }
      try {
        const updated = await client.list(eventId, controller.signal);
        if (isCurrent(controller)) setValue(updated);
      } catch (failure) {
        if (!isCurrent(controller)) return;
        if (failure instanceof SessionExpiredError || failure instanceof PrivateRequestError && [401, 403, 404].includes(failure.status)) fail(failure);
        else {
          setValue(undefined);
          setError('The operation was acknowledged, but the updated tester link list could not be loaded. Refresh tester access before another change.');
        }
      }
    } catch (failure) {
      if (isCurrent(controller)) fail(failure);
    } finally {
      if (request.current === controller) request.current = null;
      if (isCurrent(controller)) setBusy(false);
    }
  }
  function create() {
    if (!value || value.eventStatus !== 'active' || attempt) return;
    setShare(undefined);
    void run(async () => {
      const secret = await generateTesterSecret();
      const linkId = crypto.randomUUID();
      return { kind: 'create', input: { linkId, tokenHash: secret.tokenHash }, etag: value.etag,
        requestId: crypto.randomUUID(), url: testerUrl(window.location.href, { eventId, linkId, token: secret.token }) };
    });
  }
  function revoke(link: TesterLink) {
    if (!value || attempt) return;
    void run(() => Promise.resolve({ kind: 'revoke', input: { linkId: link.linkId, revision: link.revision },
      etag: value.etag, requestId: crypto.randomUUID() }));
  }
  async function copy() {
    const original = shareNow.current;
    if (!original) return;
    setCopied('');
    try {
      if (typeof navigator.clipboard === 'undefined') throw new Error('Clipboard unavailable.');
      await navigator.clipboard.writeText(original.url);
      if (alive.current && shareNow.current === original) setCopied('Private tester link copied.');
    } catch {
      if (alive.current && shareNow.current === original) setCopied('Copy failed. Select the private link field and copy it manually.');
    }
  }
  const locked = busy || !!attempt || conflict;
  return <section className="tester-access" aria-label="No-account tester access">
    <h2>No-account tester access</h2>
    <p>Create a private, revocable link for any playing group in this event only. Anyone holding it can enter scores.
      No guest account, sign-in, claim or approval is needed. Links expire 24 hours after creation.</p>
    <p>Changes use a shared tester-link identity, not an individually verified person. No game or event setup edits are allowed.
      Nothing is emailed or messaged automatically. Account-based player invitations remain a separate option.</p>
    <p>Links cannot be recovered after reloading. If a link is lost, revoke it and create a fresh link.</p>
    <button disabled={busy || !!attempt && !conflict} onClick={() => { void load(); }}>
      {conflict ? 'Refresh and review tester access' : 'Refresh tester access'}
    </button>
    {busy && <p role="status">Updating tester access…</p>}
    {error && <p role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {attempt && !conflict && <div>
      <p>The original operation and any generated secret are retained privately on this page.</p>
      <button disabled={busy} onClick={() => { void run(() => Promise.resolve(attempt)); }}>Retry original tester operation</button>
    </div>}
    {share && <div>
      <label>Private tester share link<input type="password" autoComplete="off" readOnly value={share.url}
        onFocus={(event) => { event.currentTarget.select(); }} /></label>
      <button onClick={() => { void copy(); }}>Copy private tester link</button>
      {copied && <p role="status">{copied}</p>}
    </div>}
    {value && <>
      {value.eventStatus === 'archived' && <p>This event is archived. New tester links are disabled; security revocation remains available.</p>}
      <button disabled={locked || value.eventStatus !== 'active'} onClick={create}>Create private tester link</button>
      {value.links.length === 0 ? <p>No tester links created for this event.</p> : <ul>
        {value.links.map((link, index) => <li key={link.linkId}>
          <strong>Tester link {index + 1}</strong> · {link.state === 'revoked' ? 'Revoked' : Date.parse(link.expiresAt) <= Date.now() ? 'Expired' : 'Active'}
          <p>Expires <time dateTime={link.expiresAt}>{new Date(link.expiresAt).toLocaleString()}</time></p>
          <button disabled={locked || link.state === 'revoked'} onClick={() => { revoke(link); }}
            aria-label={`Revoke tester link ${String(index + 1)}`}>Revoke link</button>
        </li>)}
      </ul>}
    </>}
  </section>;
}
