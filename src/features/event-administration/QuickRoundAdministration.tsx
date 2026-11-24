import { useEffect, useRef, useState } from 'react';
import type { EventAdministrationClient } from '../../client/event-administration';
import type { AdministrableEvent, EventDeletionResult } from '../../domain/event-administration';
import type { EventStatus } from '../../domain/events';
import { ArchivedEventDeletion, PendingEventDeletion } from './ArchivedEventDeletion';
import type { DeletionPacing } from './useDeletionRunner';
import './event-administration.css';

export interface QuickRoundAdministrationProps {
  readonly client: EventAdministrationClient;
  readonly onChanged?: () => void;
  /** Tests shorten the pauses between automatic deletion requests. */
  readonly deletionPacing?: DeletionPacing;
}

export function QuickRoundAdministration({ client, onChanged, deletionPacing }: QuickRoundAdministrationProps) {
  const [status, setStatus] = useState<EventStatus>('active');
  const [events, setEvents] = useState<readonly AdministrableEvent[]>([]);
  const [cursor, setCursor] = useState<string>();
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [childBusy, setChildBusy] = useState(false);
  const [deleting, setDeleting] = useState<readonly string[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [jobs, setJobs] = useState<readonly EventDeletionResult[]>([]);
  const [jobsCursor, setJobsCursor] = useState<string>();
  const [jobsError, setJobsError] = useState('');
  const [jobsLoaded, setJobsLoaded] = useState(false);
  const [jobsBusy, setJobsBusy] = useState(false);
  const controllers = useRef(new Set<AbortController>());
  const restores = useRef(new Map<string, string>());
  const title = useRef<HTMLHeadingElement>(null);
  const source = useRef(0);
  const seen = useRef(new Set<string>());
  const seenJobs = useRef(new Set<string>());
  useEffect(() => {
    const active = controllers.current;
    return () => { active.forEach((controller) => { controller.abort(); }); active.clear(); };
  }, []);

  async function load(reset = false, nextStatus = status) {
    if (busy || childBusy) return;
    const generation = ++source.current;
    const controller = new AbortController();
    controllers.current.add(controller);
    setBusy(true);
    setError('');
    if (reset) { setEvents([]); setCursor(undefined); setLoaded(false); seen.current.clear(); }
    try {
      const next = await client.listQuick(controller.signal, reset ? undefined : cursor, nextStatus);
      if (controller.signal.aborted || generation !== source.current) return;
      if (next.continuationToken && seen.current.has(next.continuationToken)) throw new Error('The directory repeated a page. Refresh Quick rounds to restart.');
      if (next.continuationToken) seen.current.add(next.continuationToken);
      setEvents((current) => [...(reset ? [] : current).filter((event) => !next.events.some((incoming) => incoming.id === event.id)), ...next.events]);
      setCursor(next.continuationToken);
      setLoaded(true);
    } catch (reason) {
      if (!controller.signal.aborted && generation === source.current) setError(reason instanceof Error ? reason.message : 'Quick rounds could not be loaded.');
    } finally {
      controllers.current.delete(controller);
      if (!controller.signal.aborted && generation === source.current) setBusy(false);
    }
  }

  async function loadJobs(reset = false) {
    if (jobsBusy) return;
    const controller = new AbortController();
    controllers.current.add(controller);
    setJobsBusy(true);
    setJobsError('');
    if (reset) {
      seenJobs.current.clear();
      setJobs([]);
      setJobsCursor(undefined);
      setJobsLoaded(false);
    }
    try {
      const next = await client.listDeletions(controller.signal, reset ? undefined : jobsCursor);
      if (controller.signal.aborted) return;
      if (next.continuationToken && seenJobs.current.has(next.continuationToken)) throw new Error('Pending deletions repeated a page. Refresh to restart.');
      if (next.continuationToken) seenJobs.current.add(next.continuationToken);
      setJobs((current) => [...(reset ? [] : current).filter((job) => !next.deletions.some((incoming) => incoming.eventId === job.eventId)), ...next.deletions]);
      setJobsCursor(next.continuationToken);
      setJobsLoaded(true);
    } catch (reason) {
      if (!controller.signal.aborted) setJobsError(reason instanceof Error ? reason.message : 'Unfinished deletions could not be loaded.');
    } finally {
      controllers.current.delete(controller);
      if (!controller.signal.aborted) setJobsBusy(false);
    }
  }

  function deleted(eventId: string, removed?: number) {
    setEvents((current) => current.filter((event) => event.id !== eventId));
    setJobs((current) => current.filter((job) => job.eventId !== eventId));
    const count = removed === undefined ? '' : ` (${String(removed)} event records removed)`;
    setNotice(`Event business data permanently deleted${count}. Shared players and courses were kept.`);
    title.current?.focus();
    onChanged?.();
  }

  return <section className="event-administration" aria-label="Quick round administration">
    <h2 ref={title} tabIndex={-1}>Quick rounds</h2>
    <div className="event-actions" role="group" aria-label="Quick round lists">
      {(['active', 'archived'] as const).map((value) => <button key={value} disabled={busy || childBusy}
        aria-pressed={status === value} onClick={() => { setStatus(value); setNotice(''); void load(true, value); }}>
        {value === 'active' ? 'Active Quick rounds' : 'Archived Quick rounds'}</button>)}
      <button disabled={busy || childBusy || jobsBusy} onClick={() => { void load(true); void loadJobs(true); }}>Refresh Quick rounds</button>
    </div>
    {!loaded && !busy && !error && <button onClick={() => { void load(); void loadJobs(); }}>Load Quick rounds</button>}
    {busy && <p role="status">Loading Quick rounds…</p>}
    {error && <p role="alert">{error} <button disabled={busy || childBusy} onClick={() => { void load(); }}>Retry Quick round page</button></p>}
    {loaded && <p>{cursor ? 'More Quick rounds are available. This is not the complete list.' : 'All pages loaded for this list.'}</p>}
    {loaded && events.length === 0 && <p>No {status} Quick rounds on the loaded pages.</p>}
    <ul className="round-list" aria-label={`${status === 'active' ? 'Active' : 'Archived'} Quick rounds`}>
      {events.map((event) => <li className="panel" key={`${event.id}:${event.etag}`}>
        <h3>{event.name}</h3>
        {event.status === 'active'
          ? <a href={`#overview?event=${encodeURIComponent(event.id)}`}>Open {event.name}</a>
          : <div className="event-form">
            <button disabled={busy || childBusy || deleting.includes(event.id)} onClick={() => {
              const controller = new AbortController();
              controllers.current.add(controller);
              const retryKey = `${event.id}:${event.etag}`;
              const requestId = restores.current.get(retryKey) ?? crypto.randomUUID();
              restores.current.set(retryKey, requestId);
              setBusy(true);
              setError('');
              void client.restore(event, requestId, controller.signal).then(() => {
                if (controller.signal.aborted) return;
                setEvents((current) => current.filter((item) => item.id !== event.id));
                setNotice(`${event.name} restored.`);
                restores.current.delete(retryKey);
                title.current?.focus();
                onChanged?.();
              }).catch((reason: unknown) => {
                if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Restore was not confirmed. Retry the same event.');
              }).finally(() => {
                controllers.current.delete(controller);
                if (!controller.signal.aborted) setBusy(false);
              });
            }}>Restore {event.name}</button>
            <ArchivedEventDeletion client={client} event={event} onDeleted={deleted} onBusyChange={setChildBusy}
              onDeletionStarted={() => { setDeleting((current) => current.includes(event.id) ? current : [...current, event.id]); }}
              disabled={busy || childBusy} {...(deletionPacing ? { pacing: deletionPacing } : {})} />
          </div>}
      </li>)}
    </ul>
    {cursor && <button disabled={busy || childBusy} onClick={() => { void load(); }}>Load more Quick rounds</button>}
    <p role="status">{notice}</p>
    <h3>Unfinished deletions</h3>
    {!jobsLoaded && !jobsError && <button disabled={jobsBusy} onClick={() => { void loadJobs(); }}>Check unfinished deletions</button>}
    {jobsError && <p role="alert">{jobsError} <button disabled={jobsBusy} onClick={() => { void loadJobs(); }}>Retry unfinished deletions</button></p>}
    <ul>{jobs.map((job) => <PendingEventDeletion key={job.eventId} client={client} job={job} onDeleted={deleted}
      {...(deletionPacing ? { pacing: deletionPacing } : {})} />)}</ul>
    {jobsCursor && <button disabled={jobsBusy} onClick={() => { void loadJobs(); }}>Load more unfinished deletions</button>}
  </section>;
}
