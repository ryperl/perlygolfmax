import { useEffect, useMemo, useState } from 'react';
import type { TesterAccessClient } from '../../client/test-access';
import { SessionExpiredError } from '../../client/events';
import { PrivateRequestError } from '../../client/private-request';
import type { TesterCredential } from '../../domain/test-access';
import type { EventWorkspace } from '../../domain/setup';
import { sortRoundsByStartDate } from '../../domain/event-schedule';
import { OwnerScoresView } from '../scoring';
import './test-access.css';

export interface TesterEntryProps {
  readonly client: TesterAccessClient;
  readonly credential: TesterCredential;
  readonly onExit: () => void;
}

export function TesterEntry(props: TesterEntryProps) {
  const { client, credential } = props;
  const stableCredential = useMemo(() => ({ eventId: credential.eventId, linkId: credential.linkId, token: credential.token }),
    [credential.eventId, credential.linkId, credential.token]);
  const identity = useMemo(() => ({ key: crypto.randomUUID(), client, credential: stableCredential }), [client, stableCredential]);
  return <TesterEntrySession key={identity.key} {...props} credential={stableCredential} />;
}

function TesterEntrySession({ client, credential, onExit }: TesterEntryProps) {
  const [workspace, setWorkspace] = useState<EventWorkspace>();
  const [roundId, setRoundId] = useState('');
  const [error, setError] = useState('');
  const [denied, setDenied] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const scores = useMemo(() => client.bindScores(credential), [client, credential]);
  function loseAccess() {
    setWorkspace(undefined); setRoundId(''); setError(''); setDenied(true);
  }
  useEffect(() => {
    const controller = new AbortController();
    void client.workspace(credential, controller.signal).then((value) => {
      if (controller.signal.aborted) return;
      if (value.event.id !== credential.eventId || value.event.status !== 'active'
        || !value.testerAccess || value.event.role !== 'viewer' || !value.canViewScores) {
        loseAccess(); return;
      }
      setWorkspace(value); setRoundId(value.rounds[0]?.id ?? '');
    }).catch((failure: unknown) => {
      if (controller.signal.aborted) return;
      if (failure instanceof SessionExpiredError || failure instanceof PrivateRequestError && [401, 403, 404, 410].includes(failure.status)) loseAccess();
      else setError('The score service could not load this event. Nothing is available offline. Try again when connected.');
    });
    return () => { controller.abort(); };
  }, [client, credential, refresh]);
  return <main className="tester-access">
    <h1>Tester score entry</h1>
    <button onClick={onExit}>Exit tester access</button>
    {denied ? <p role="alert">This tester link is unavailable, expired or revoked. Ask the organizer for a fresh private link.</p>
      : <>
        <p>No account or sign-in needed. This private link permits score entry for any saved playing group in this event only.
          Changes are attributed to the shared tester link, not an individually verified person.</p>
        {error && <><p role="alert">{error}</p><button onClick={() => { setError(''); setRefresh((value) => value + 1); }}>Retry loading event</button></>}
        {!workspace && !error && <p role="status">Loading this event…</p>}
        {workspace && <>
          <h2>{workspace.event.name}</h2>
          {workspace.rounds.length === 0 ? <p>The organizer needs to save a round and playing groups before you can enter scores.</p>
            : <>
              <label>Saved round<select value={roundId} onChange={(event) => { setRoundId(event.target.value); }}>
                {sortRoundsByStartDate(workspace.rounds).map((round) => <option key={round.id} value={round.id}>{round.name}</option>)}
              </select></label>
              <OwnerScoresView client={scores} eventId={credential.eventId} roundId={roundId}
                overviewHref={null} onSessionExpired={loseAccess} />
            </>}
        </>}
      </>}
  </main>;
}
