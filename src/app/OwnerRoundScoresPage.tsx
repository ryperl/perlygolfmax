import { useCallback, useEffect, useRef, useState } from 'react';
import type { SetupClient } from '../client/setup';
import type { ScoresClient } from '../client/scoring';
import { SessionExpiredError } from '../client/events';
import type { EventWorkspace } from '../domain/setup';
import type { ScoreLocation, ScoreView } from '../domain/score-location';
import { sortRoundsByStartDate } from '../domain/event-schedule';
import { groupStartingHole } from '../domain/round-navigation';
import { OwnerScoresView } from '../features/scoring';

export function OwnerRoundScoresPage({ setup, scores, eventId, roundId, onSessionExpired }: {
  readonly setup: SetupClient;
  readonly scores: ScoresClient;
  readonly eventId: string;
  readonly roundId: string;
  readonly onSessionExpired: (message: string) => void;
}) {
  const [result, setResult] = useState<{ readonly client: SetupClient; readonly eventId: string;
    readonly workspace?: EventWorkspace; readonly error?: string }>();
  const [blocked, setBlocked] = useState(false);
  const [view, setView] = useState<ScoreView>('cards');
  const [attempt, setAttempt] = useState(0);
  const expired = useRef(onSessionExpired);
  useEffect(() => { expired.current = onSessionExpired; }, [onSessionExpired]);
  useEffect(() => {
    const controller = new AbortController();
    void setup.load(eventId, controller.signal).then((workspace) => {
      if (!controller.signal.aborted) setResult({ client: setup, eventId, workspace });
    }).catch((failure: unknown) => {
      if (controller.signal.aborted) return;
      const message = failure instanceof Error ? failure.message : 'Saved rounds could not be loaded. No round was selected.';
      setResult({ client: setup, eventId, error: message });
      if (failure instanceof SessionExpiredError) expired.current(message);
    });
    return () => { controller.abort(); };
  }, [setup, eventId, attempt]);
  const rememberView = useCallback((location: ScoreLocation) => { setView(location.view); }, []);
  const current = result?.client === setup && result.eventId === eventId ? result : undefined;
  if (!current) return <p role="status">Loading saved rounds…</p>;
  if (current.error) return <section><p role="alert">{current.error}</p><button onClick={() => {
    setResult(undefined);
    setAttempt((value) => value + 1);
  }}>Retry saved rounds</button></section>;
  const workspace = current.workspace;
  const selected = workspace?.rounds.find((round) => round.id === roundId);
  if (!workspace || !selected) return <p role="alert">This round is no longer available. Return to the event overview to select a saved round.</p>;
  const firstGroup = selected.groups[0];
  const startingHole = groupStartingHole(firstGroup, selected.teeProfile.holes);
  const initialLocation = firstGroup && startingHole !== undefined
    ? { groupNumber: firstGroup.number, holeNumber: startingHole, view } : undefined;
  return <OwnerScoresView client={scores} eventId={eventId} roundId={roundId}
    initialLocation={initialLocation} onLocationChange={rememberView} onSessionExpired={onSessionExpired}
    onNavigationBlockedChange={setBlocked} overviewHref={`#overview?event=${encodeURIComponent(eventId)}`}
    roundTools={<>
      <label>Saved round<select aria-label="Saved round" value={roundId} disabled={blocked} onChange={(event) => {
        if (blocked) return;
        window.location.hash = `#organizer?${new URLSearchParams({ event: eventId, round: event.target.value }).toString()}`;
      }}>{sortRoundsByStartDate(workspace.rounds).map((round) => <option key={round.id} value={round.id}>{round.name}</option>)}</select></label>
      <p className="score-hint">Switching rounds requires active requests to finish and local edits to be saved or discarded. Save or cancel game settings first.</p>
    </>} />;
}
