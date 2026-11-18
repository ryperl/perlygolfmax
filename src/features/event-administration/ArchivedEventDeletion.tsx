import { useEffect, useId, useRef, useState } from 'react';
import type { EventAdministrationClient } from '../../client/event-administration';
import type { AdministrableEvent, EventDeletionResult } from '../../domain/event-administration';
import './event-administration.css';

interface ArchivedEventDeletionProps {
  readonly client: EventAdministrationClient;
  readonly event: AdministrableEvent;
  readonly onDeleted: (eventId: string) => void;
  readonly onBusyChange?: (busy: boolean) => void;
  readonly disabled?: boolean;
  readonly onDeletionStarted?: () => void;
}

export function ArchivedEventDeletion({ client, event, onDeleted, onBusyChange, onDeletionStarted, disabled = false }: ArchivedEventDeletionProps) {
  return <ArchivedEventDeletionForm key={`${event.id}:${event.etag}`} client={client} event={event}
    onDeleted={onDeleted} {...(onBusyChange ? { onBusyChange } : {})}
    {...(onDeletionStarted ? { onDeletionStarted } : {})} disabled={disabled} />;
}

function ArchivedEventDeletionForm({ client, event, onDeleted, onBusyChange, onDeletionStarted, disabled = false }: ArchivedEventDeletionProps) {
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const [operation, setOperation] = useState<{ readonly id: string; readonly started: boolean }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const button = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const controller = useRef<AbortController | undefined>(undefined);
  const opened = useRef(false);
  const id = useId();
  useEffect(() => () => { controller.current?.abort(); }, []);
  useEffect(() => {
    if (open) input.current?.focus();
    else if (opened.current) button.current?.focus();
  }, [open]);
  if (event.status !== 'archived') return null;

  async function remove() {
    if (busy) return;
    const requestId = operation?.id ?? crypto.randomUUID();
    const started = operation?.started ?? false;
    setOperation({ id: requestId, started });
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    onBusyChange?.(true);
    onDeletionStarted?.();
    setError('');
    try {
      const result = started
        ? await client.continueDeletion(event.id, requestId, abort.signal)
        : await client.deleteArchived(event, confirmation, requestId, abort.signal);
      if (abort.signal.aborted) return;
      if (result.state === 'deleted') onDeleted(event.id);
      else setOperation({ id: requestId, started: true });
    } catch (reason) {
      if (!abort.signal.aborted) setError(reason instanceof Error ? reason.message : 'Deletion could not be confirmed. Retry unchanged.');
    } finally {
      if (!abort.signal.aborted) { setBusy(false); onBusyChange?.(false); }
    }
  }
  return <div>
    {!open ? <button className="event-deletion-trigger" ref={button} type="button" disabled={disabled} onClick={() => { opened.current = true; setOpen(true); }}>Permanently delete {event.name}</button>
      : <form className="event-form event-deletion-form" aria-label={`Permanently delete ${event.name}`} onSubmit={(submit) => { submit.preventDefault(); void remove(); }}>
        <p id={`${id}-warning`}>Permanently removes this event’s scores, rounds, captures, settings, invitations and history. This cannot be undone. Shared players and courses are kept.</p>
        <label htmlFor={id}>Type {event.name} to confirm</label>
        <input ref={input} id={id} value={confirmation} maxLength={100} disabled={busy || operation !== undefined}
          aria-describedby={`${id}-warning`} onChange={(change) => { setConfirmation(change.target.value); }} />
        {error && <p role="alert">{error}</p>}
        {operation?.started && <p role="status">Deletion in progress. This event is unavailable. Continue until cleanup is confirmed.</p>}
        <div className="event-actions">
          <button type="submit" disabled={busy || confirmation !== event.name}>{busy ? 'Deleting…'
            : operation?.started ? 'Continue deletion' : operation ? 'Retry deletion' : 'Permanently delete event'}</button>
          {!operation && <button type="button" disabled={busy} onClick={() => { setOpen(false); setConfirmation(''); button.current?.focus(); }}>Cancel deletion</button>}
        </div>
      </form>}
  </div>;
}

export function PendingEventDeletion({ client, job, onDeleted }: {
  readonly client: EventAdministrationClient;
  readonly job: EventDeletionResult;
  readonly onDeleted: (eventId: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const abort = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => { abort.current?.abort(); }, []);
  return <li>
    <p>Unfinished event deletion ({job.eventId.slice(0, 8)}). The event stays unavailable.</p>
    {error && <p role="alert">{error}</p>}
    <button disabled={busy} onClick={() => {
      const controller = new AbortController();
      abort.current = controller;
      setBusy(true);
      setError('');
      void client.continueDeletion(job.eventId, job.requestId, controller.signal).then((result) => {
        if (!controller.signal.aborted && result.state === 'deleted') onDeleted(job.eventId);
      }).catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Cleanup was not confirmed. Retry.');
      }).finally(() => { if (!controller.signal.aborted) setBusy(false); });
    }}>{busy ? 'Cleaning up…' : 'Continue unfinished deletion'}</button>
  </li>;
}
