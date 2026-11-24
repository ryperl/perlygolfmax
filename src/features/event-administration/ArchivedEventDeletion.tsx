import { useEffect, useId, useRef, useState } from 'react';
import type { EventAdministrationClient } from '../../client/event-administration';
import type { AdministrableEvent, EventDeletionResult } from '../../domain/event-administration';
import { useDeletionRunner } from './useDeletionRunner';
import type { DeletionPacing } from './useDeletionRunner';
import './event-administration.css';

interface ArchivedEventDeletionProps {
  readonly client: EventAdministrationClient;
  readonly event: AdministrableEvent;
  readonly onDeleted: (eventId: string, removed?: number) => void;
  readonly onBusyChange?: (busy: boolean) => void;
  readonly disabled?: boolean;
  readonly onDeletionStarted?: () => void;
  readonly pacing?: DeletionPacing;
}

export function ArchivedEventDeletion(props: ArchivedEventDeletionProps) {
  // A changed revision is a different deletion request, so start a fresh form.
  return <ArchivedEventDeletionForm key={`${props.event.id}:${props.event.etag}`} {...props} />;
}

function ArchivedEventDeletionForm({ client, event, onDeleted, onBusyChange, onDeletionStarted, pacing, disabled = false }: ArchivedEventDeletionProps) {
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const [attempted, setAttempted] = useState(false);
  // One request identity for this form, so retries and resumes continue the same server job.
  const [requestId] = useState(() => crypto.randomUUID());
  const deletion = useDeletionRunner(client, event.id, requestId, onDeleted, pacing);
  const button = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const opened = useRef(false);
  const id = useId();
  useEffect(() => {
    if (open) input.current?.focus();
    else if (opened.current) button.current?.focus();
  }, [open]);
  useEffect(() => { onBusyChange?.(deletion.running); }, [deletion.running, onBusyChange]);
  // A finished deletion removes this panel before its own "not running" update can be
  // reported, so always release the host's busy lock on the way out.
  useEffect(() => () => { onBusyChange?.(false); }, [onBusyChange]);
  if (event.status !== 'archived') return null;

  function start() {
    if (deletion.running) return;
    setAttempted(true);
    onDeletionStarted?.();
    void deletion.run(deletion.started
      ? (signal) => client.continueDeletion(event.id, requestId, signal)
      : (signal) => client.deleteArchived(event, confirmation, requestId, signal));
  }

  function submitLabel(): string {
    if (deletion.running) return 'Deleting…';
    if (deletion.started) return 'Resume deletion';
    return attempted ? 'Retry deletion' : 'Permanently delete event';
  }

  if (!open) {
    return <div>
      <button className="event-deletion-trigger" ref={button} type="button" disabled={disabled}
        onClick={() => { opened.current = true; setOpen(true); }}>Permanently delete {event.name}</button>
    </div>;
  }
  return <div>
    <form className="event-form event-deletion-form" aria-label={`Permanently delete ${event.name}`}
      onSubmit={(submit) => { submit.preventDefault(); start(); }}>
      <p id={`${id}-warning`}>Permanently removes this event’s scores, rounds, captures, settings, invitations and history. This cannot be undone. Shared players and courses are kept.</p>
      <label htmlFor={id}>Type {event.name} to confirm</label>
      <input ref={input} id={id} value={confirmation} maxLength={100} disabled={deletion.running || attempted}
        aria-describedby={`${id}-warning`} onChange={(change) => { setConfirmation(change.target.value); }} />
      {deletion.error && <p role="alert">{deletion.error}</p>}
      {(deletion.running || deletion.started) && <p role="status">
        {deletion.running ? deletion.status
          : 'Deletion paused. This event stays unavailable until cleanup finishes.'}</p>}
      <div className="event-actions">
        <button type="submit" disabled={deletion.running || confirmation !== event.name}>{submitLabel()}</button>
        {!attempted && <button type="button" onClick={() => { setOpen(false); setConfirmation(''); }}>Cancel deletion</button>}
      </div>
    </form>
  </div>;
}

export function PendingEventDeletion({ client, job, onDeleted, pacing }: {
  readonly client: EventAdministrationClient;
  readonly job: EventDeletionResult;
  readonly onDeleted: (eventId: string, removed?: number) => void;
  readonly pacing?: DeletionPacing;
}) {
  const deletion = useDeletionRunner(client, job.eventId, job.requestId, onDeleted, pacing, true);
  return <li>
    <p>Unfinished event deletion ({job.eventId.slice(0, 8)}). The event stays unavailable.</p>
    {deletion.running && <p role="status">{deletion.status}</p>}
    {deletion.error && <p role="alert">{deletion.error}</p>}
    <button disabled={deletion.running} onClick={() => {
      void deletion.run((signal) => client.continueDeletion(job.eventId, job.requestId, signal));
    }}>{deletion.running ? 'Cleaning up…' : 'Resume deletion'}</button>
  </li>;
}
