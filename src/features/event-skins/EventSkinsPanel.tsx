import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { EventSkinsDetails } from '../../domain/event-skins-details';
import type { EventSkinsDisplay } from '../../domain/public-leaderboard';
import { SessionExpiredError } from '../../client/events';
import { PrivateRequestError } from '../../client/private-request';
import { EventSkinsBoard } from './EventSkinsBoard';
import { EventSkinsDetailsView } from './EventSkinsDetailsView';
import type { EventSkinsHoleSelection } from './EventSkinsDetailsView';

export function EventSkinsPanel({ value, loadDetails, onSessionExpired, onAccessEnded }: {
  readonly value: EventSkinsDisplay;
  readonly loadDetails?: ((signal: AbortSignal) => Promise<EventSkinsDetails>) | undefined;
  readonly onSessionExpired: (message: string) => void;
  readonly onAccessEnded?: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [denied, setDenied] = useState(false);
  const [selection, setSelection] = useState<EventSkinsHoleSelection>();
  const [result, setResult] = useState<{ readonly attempt: number; readonly value?: EventSkinsDetails; readonly error?: string }>();
  const trigger = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const returning = useRef(false);
  const expiry = useRef(onSessionExpired);
  const ended = useRef(onAccessEnded);
  const current = result?.attempt === attempt ? result : undefined;
  useEffect(() => { expiry.current = onSessionExpired; }, [onSessionExpired]);
  useEffect(() => { ended.current = onAccessEnded; }, [onAccessEnded]);
  useLayoutEffect(() => {
    if (open) heading.current?.focus();
    else if (returning.current) { returning.current = false; trigger.current?.focus(); }
  }, [open]);
  useEffect(() => {
    if (!open || !loadDetails) return;
    const controller = new AbortController();
    void loadDetails(controller.signal).then((detail) => {
      if (controller.signal.aborted) return;
      if (detail.eventId !== value.workspace.event.id) throw new Error('Skins details did not match this event.');
      setResult({ attempt, value: detail });
      setDenied(false);
    }).catch((failure: unknown) => {
      if (controller.signal.aborted) return;
      const error = failure instanceof Error ? failure.message : 'Skins details could not be loaded.';
      setResult({ attempt, error });
      if (failure instanceof SessionExpiredError || failure instanceof PrivateRequestError && failure.status === 401) {
        setDenied(true); expiry.current(error);
      } else if (failure instanceof PrivateRequestError && [403, 404].includes(failure.status)) {
        setDenied(true); ended.current?.(error);
      }
    });
    return () => { controller.abort(); };
  }, [open, attempt, loadDetails, value.workspace.event.id]);
  if (!open) return <EventSkinsBoard value={value} detailsTrigger={trigger}
    {...(loadDetails ? { onDetails: () => { setAttempt((previous) => previous + 1); setOpen(true); } } : {})} />;
  return <section className="event-skins-board">
    <h2 tabIndex={-1} ref={heading}>Skins details</h2>
    <div className="event-actions">
      <button disabled={denied} onClick={() => { returning.current = true; setOpen(false); }}>Back to skins</button>
      <button disabled={!current} onClick={() => { setAttempt((previous) => previous + 1); }}>Refresh skins details</button>
    </div>
    {!current && <p role="status">Loading skins details…</p>}
    {current?.error && <p role="alert">{current.error}</p>}
    {denied && <a href="#events">Choose another event</a>}
    {current?.value && <EventSkinsDetailsView value={current.value} selection={selection} onSelect={setSelection} />}
  </section>;
}
