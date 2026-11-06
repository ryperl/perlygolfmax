import { useEffect, useRef, useState } from 'react';
import { SessionExpiredError } from '../client/events';
import type { SetupClient } from '../client/setup';
import type { ScoresClient } from '../client/scoring';
import { PrivateRequestError } from '../client/private-request';
import type { EventWorkspace } from '../domain/setup';
import { EventTripView, summarizeEntryProgress } from '../features/event-trip';
import type { EventEntryProgress, RoundEntryProgressState } from '../features/event-trip';
import type { EventTab } from './navigation';

type SavedEventState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly workspace: EventWorkspace }
  | { readonly kind: 'error'; readonly message: string };

export function SavedEventPage({ client, scores, eventId, view, onSessionExpired }: {
  readonly client: SetupClient;
  readonly scores?: ScoresClient;
  readonly eventId: string;
  readonly view: EventTab;
  readonly onSessionExpired: (message: string) => void;
}) {
  const [refresh, setRefresh] = useState(0);
  const [result, setResult] = useState<{
    readonly client: SetupClient;
    readonly eventId: string;
    readonly refresh: number;
    readonly state: SavedEventState;
  } | null>(null);
  const state: SavedEventState = result?.client === client && result.eventId === eventId && result.refresh === refresh
    ? result.state : { kind: 'loading' };
  const workspace = state.kind === 'ready' ? state.workspace : null;
  const [progressResult, setProgressResult] = useState<{
    readonly workspace: EventWorkspace;
    readonly client: SetupClient;
    readonly scores: ScoresClient;
    readonly eventId: string;
    readonly refresh: number;
    readonly progress: EventEntryProgress;
  } | null>(null);
  const progress: EventEntryProgress = progressResult?.workspace === workspace && progressResult.client === client
    && progressResult.scores === scores && progressResult.eventId === eventId && progressResult.refresh === refresh
    ? progressResult.progress : Object.fromEntries((workspace?.rounds ?? []).map((round) =>
      [round.id, { kind: scores && (workspace?.event.role === 'owner' || workspace?.canViewScores === true) ? 'loading' : 'unavailable' }]));
  const expiryHandler = useRef(onSessionExpired);
  useEffect(() => { expiryHandler.current = onSessionExpired; }, [onSessionExpired]);
  useEffect(() => {
    const controller = new AbortController();
    void client.load(eventId, controller.signal).then((workspace) => {
      if (!controller.signal.aborted) setResult({ client, eventId, refresh, state: { kind: 'ready', workspace } });
    }).catch((failure: unknown) => {
      if (controller.signal.aborted) return;
      const message = failure instanceof Error ? failure.message : 'Could not load this saved event. Try again.';
      setResult({ client, eventId, refresh, state: { kind: 'error', message } });
      if (failure instanceof SessionExpiredError) expiryHandler.current(message);
    });
    return () => { controller.abort(); };
  }, [client, eventId, refresh]);
  useEffect(() => {
    if (!workspace || workspace.event.id !== eventId
      || workspace.event.role !== 'owner' && workspace.canViewScores !== true || !scores) return;
    const controller = new AbortController();
    const identity = { workspace, client, scores, eventId, refresh };
    const activeWorkspace = workspace;
    const activeScores = scores;
    const isActive = () => !controller.signal.aborted;
    const unavailable: EventEntryProgress = Object.fromEntries(workspace.rounds.map((round) => [round.id, { kind: 'unavailable' }]));
    let entries: EventEntryProgress = Object.fromEntries(workspace.rounds.map((round) => [round.id, { kind: 'loading' }]));
    function publish(roundId: string, value: RoundEntryProgressState) {
      entries = { ...entries, [roundId]: value };
      setProgressResult({ ...identity, progress: entries });
    }
    let next = 0;
    async function worker() {
      while (isActive()) {
        const round = activeWorkspace.rounds[next++];
        if (!round) return;
        try {
          const saved = await activeScores.load(eventId, round.id, controller.signal);
          if (!isActive()) return;
          publish(round.id, saved.eventStatus === activeWorkspace.event.status
            ? summarizeEntryProgress(eventId, round, saved, activeWorkspace.overallCompetition?.kind === 'stableford'
              ? activeWorkspace.overallCompetition.roundGames.find((binding) => binding.roundId === round.id)?.gameId : undefined)
            : { kind: 'unavailable' });
        } catch (failure: unknown) {
          if (!isActive()) return;
          if (failure instanceof SessionExpiredError
            || failure instanceof PrivateRequestError && [401, 403, 404].includes(failure.status)) {
            controller.abort();
            setProgressResult({ ...identity, progress: unavailable });
            setResult((previous) => previous?.client === client && previous.eventId === eventId
              && previous.refresh === refresh && previous.state.kind === 'ready'
              && previous.state.workspace === activeWorkspace
              ? { client, eventId, refresh, state: { kind: 'error', message: failure.message } } : previous);
            if (failure instanceof SessionExpiredError || failure instanceof PrivateRequestError && failure.status === 401) {
              expiryHandler.current(failure.message);
            }
            return;
          }
          publish(round.id, { kind: 'unavailable' });
        }
      }
    }
    for (let index = 0; index < Math.min(3, workspace.rounds.length); index++) void worker();
    return () => { controller.abort(); };
  }, [workspace, client, scores, eventId, refresh]);
  return <section>
    <div className="event-actions"><button disabled={state.kind === 'loading'} onClick={() => { setRefresh((value) => value + 1); }}>Refresh event</button></div>
    {state.kind === 'loading' && <p role="status">Loading saved event…</p>}
    {state.kind === 'error' && <div className="panel"><p role="alert">{state.message}</p><a href="#events">Choose another event</a></div>}
    {state.kind === 'ready' && <EventTripView workspace={state.workspace} view={view} progress={progress} />}
  </section>;
}
