import { useEffect, useRef, useState } from 'react';
import type { PublicServices } from '../client/public-events';
import type { EventServices } from './EventsPage';
import { configuredEventServices } from './event-services';
import { SavedEventPage } from './SavedEventPage';

export function PublicGroupPage({ services, eventId, onUnavailable, organizer = configuredEventServices.services }: {
  readonly services: PublicServices;
  readonly eventId: string;
  readonly onUnavailable: (message: string) => void;
  readonly organizer?: EventServices | undefined;
}) {
  const [access, setAccess] = useState<{ readonly organizer: EventServices; readonly eventId: string }>();
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const request = useRef<AbortController | null>(null);
  useEffect(() => {
    if (!organizer) return;
    const controller = new AbortController();
    request.current = controller;
    void organizer.session.initialize().then(async (signedIn) => {
      if (!signedIn) return;
      controller.signal.throwIfAborted();
      const capabilities = await organizer.events.capabilities(controller.signal);
      controller.signal.throwIfAborted();
      if (capabilities.canManageCatalog && capabilities.playerHandicapUpdatesSupported === true) {
        setAccess({ organizer, eventId });
      }
    }).catch((failure: unknown) => {
      if (!controller.signal.aborted) {
        setError(failure instanceof Error ? failure.message : 'HI editing access could not be checked.');
      }
    });
    return () => { controller.abort(); };
  }, [organizer, eventId, attempt]);
  const allowed = access !== undefined && access.organizer === organizer && access.eventId === eventId;
  return <>
    {error && <p role="alert">HI editing unavailable: {error}{' '}
      <button onClick={() => { setError(''); setAccess(undefined); setAttempt((previous) => previous + 1); }}>Retry HI access</button>
    </p>}
    <SavedEventPage client={services.setup} scores={services.scores} eventId={eventId} view="group"
      catalog={allowed ? access.organizer.catalog : undefined} onSessionExpired={onUnavailable}
      onHandicapAccessLost={(message) => { request.current?.abort(); setAccess(undefined); setError(message); }} />
  </>;
}
