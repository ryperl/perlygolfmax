import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { AdmissionsClient } from '../../client/admission';
import type { PlayerAdmissionStatus } from '../../domain/admission';
import { AccessPolicy } from './AccessPolicy';
import { admissionFailure } from './shared';
import './admission.css';

export interface JoinAccessProps {
  readonly client: AdmissionsClient;
  readonly eventId: string;
  readonly inviteId: string;
  readonly token?: string | undefined;
  readonly signedIn: boolean;
  readonly onSessionExpired: (message: string) => void;
  readonly onClaimed?: (inviteId: string) => void;
  readonly onApproved?: () => void;
}

export function JoinAccess(props: JoinAccessProps) {
  const identity = useMemo(() => ({ key: crypto.randomUUID(), client: props.client, eventId: props.eventId,
    inviteId: props.inviteId, signedIn: props.signedIn }), [props.client, props.eventId, props.inviteId, props.signedIn]);
  return <JoinAccessSession key={identity.key} {...props} />;
}

function JoinAccessSession({ client, eventId, inviteId, token, signedIn, onSessionExpired, onClaimed, onApproved }: JoinAccessProps) {
  const [value, setValue] = useState<PlayerAdmissionStatus>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [retry, setRetry] = useState(false);
  const requestId = useRef<string | undefined>(undefined);
  const request = useRef<AbortController | null>(null);
  const alive = useRef(true);
  const claimed = useRef(false);
  const callbacks = useRef({ onSessionExpired, onClaimed, onApproved });
  const notifiedTransition = useRef<string | undefined>(undefined);
  useLayoutEffect(() => { callbacks.current = { onSessionExpired, onClaimed, onApproved }; }, [onSessionExpired, onClaimed, onApproved]);
  useEffect(() => {
    if (!value) return;
    const transition = `${eventId}:${inviteId}:${value.state}`;
    if (notifiedTransition.current === transition) return;
    notifiedTransition.current = transition;
    if (value.state === 'approved') callbacks.current.onApproved?.();
  }, [eventId, inviteId, value]);

  function fail(error: unknown) {
    const failure = admissionFailure(error);
    setError(failure.message);
    setValue(undefined);
    if (failure.denied || failure.definitive || failure.conflict) {
      requestId.current = undefined; setRetry(false); setBlocked(true);
    }
    if (failure.expired) callbacks.current.onSessionExpired(failure.message);
  }
  async function load() {
    if (!signedIn || request.current) return;
    const controller = new AbortController();
    request.current = controller; setBusy(true); setError('');
    try {
      const next = await client.status(eventId, inviteId, controller.signal);
      if (!alive.current || controller.signal.aborted) return;
      setValue(next); setBlocked(false);
    } catch (error) {
      if (alive.current && !controller.signal.aborted) fail(error);
    } finally {
      if (request.current === controller) request.current = null;
      if (alive.current && !controller.signal.aborted) setBusy(false);
    }
  }
  useLayoutEffect(() => {
    alive.current = true;
    return () => { alive.current = false; request.current?.abort(); request.current = null; };
  }, []);
  useLayoutEffect(() => {
    // Removing the secret after a successful claim must retain the returned status.
    setRetry(false);
    setBusy(false);
    if (signedIn && !token && !claimed.current && !requestId.current) void load();
    return () => {
      if (!claimed.current) {
        request.current?.abort(); request.current = null; requestId.current = undefined;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn, token]);

  async function claim() {
    if (!signedIn || !token || request.current || claimed.current || blocked) return;
    const controller = new AbortController();
    request.current = controller; setBusy(true); setError('');
    const id = requestId.current ?? crypto.randomUUID();
    requestId.current = id; setRetry(true);
    try {
      const next = await client.claim(eventId, { inviteId, token }, id, controller.signal);
      if (!alive.current || controller.signal.aborted) return;
      claimed.current = true; requestId.current = undefined;
      setValue(next); setRetry(false);
      callbacks.current.onClaimed?.(inviteId);
    } catch (error) {
      if (alive.current && !controller.signal.aborted) fail(error);
    } finally {
      if (request.current === controller) request.current = null;
      if (alive.current && !controller.signal.aborted) setBusy(false);
    }
  }
  return <section className="admission-panel" aria-label="Join event">
    <h1>Player invitation</h1>
    {!signedIn ? <p>Sign in using the button above, then return here to request access. Signing in does not grant event access.</p>
      : <>
        <AccessPolicy />
        {busy && <p role="status">Checking player access…</p>}
        {error && <p role="alert">{error}</p>}
        {!value && token && !claimed.current && !blocked && <div>
          <p>Request access only if this invitation was intended for you. The organizer must verify and approve your request.
            Links expire after 24 hours; approved membership does not expire with the link.</p>
          <button disabled={busy} onClick={() => { void claim(); }}>{retry ? 'Retry original access request' : 'Request access'}</button>
        </div>}
        {value && <>
          <h2>{value.eventName}</h2><p>Roster golfer: {value.displayName}</p>
          {value.state === 'pending' && <>
            <p>Your request is pending owner approval. No access has been granted yet.</p>
            <p>Read this verification code to the organizer: <strong>{value.verificationCode}</strong></p>
            <p>Ask the organizer to verify you and explicitly approve your admission.</p>
            <button disabled={busy} onClick={() => { void load(); }}>Check approval</button>
          </>}
          {value.state === 'approved' && <>
            <p>Your admission is approved. You can view all active events.</p>
            <p>For score entry, choose the round and your assigned saved playing group. Competition teams do not extend that scope.</p>
            <a href={`#overview?event=${encodeURIComponent(eventId)}`}>Open event overview</a>
          </>}
          {value.state === 'revoked' && <p role="alert">This event admission has been revoked. This invitation no longer grants access.
            Other approved admissions may still grant general read-only visibility. Contact the organizer.</p>}
          {value.state === 'replaced' && <p role="alert">This invitation was replaced and no longer grants access. Ask the organizer for the new link.</p>}
        </>}
        {(!token || claimed.current) && !value && !busy && !blocked && !error && <button onClick={() => { void load(); }}>Check approval</button>}
        {blocked && <p>No access was confirmed. Contact the organizer or return with the correct account and a valid invitation.</p>}
        {error && (!token || claimed.current) && <button disabled={busy} onClick={() => { void load(); }}>Retry status check</button>}
      </>}
  </section>;
}
