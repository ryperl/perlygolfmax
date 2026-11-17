import { useEffect, useId, useRef, useState } from 'react';
import type { QuickRoundClient } from '../../client/quick-round';
import { EventChangedError } from '../../client/events';
import type { EventSummary } from '../../domain/events';
import './quick-round.css';

interface Props {
  readonly client: Pick<QuickRoundClient, 'archive'>;
  readonly event: EventSummary;
  readonly disabled?: boolean;
  readonly onArchived: () => void;
  readonly onRefresh: () => void;
  readonly onBusyChange?: (busy: boolean) => void;
}

export function QuickRoundArchive(props: Props) {
  if (!props.client.archive || props.event.quickRound !== true || props.event.status !== 'active') return null;
  return <ArchiveConfirmation key={`${props.event.id}:${props.event.etag}`} {...props} archive={props.client.archive} />;
}

function ArchiveConfirmation({ archive, event, disabled = false, onArchived, onRefresh, onBusyChange }: Props & {
  readonly archive: NonNullable<QuickRoundClient['archive']>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const [attempt, setAttempt] = useState<{ readonly id: string; readonly etag: string }>();
  const request = useRef<AbortController | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const title = useId();
  useEffect(() => () => { request.current?.abort(); }, []);
  useEffect(() => { if (confirming) heading.current?.focus(); }, [confirming]);

  async function submit() {
    if (disabled || request.current || conflict) return;
    const pending = attempt ?? { id: crypto.randomUUID(), etag: event.etag };
    setAttempt(pending);
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    onBusyChange?.(true);
    setError('');
    try {
      await archive(event.id, pending.etag, pending.id, controller.signal);
      if (!controller.signal.aborted) onArchived();
    } catch (failure) {
      if (!controller.signal.aborted) {
        setConflict(failure instanceof EventChangedError);
        setError(failure instanceof Error ? failure.message : 'Archive is not confirmed. Retry or refresh to review.');
      }
    } finally {
      request.current = null;
      if (!controller.signal.aborted) { setBusy(false); onBusyChange?.(false); }
    }
  }
  return <div className="quick-archive">
    <button ref={trigger} type="button" disabled={disabled || busy} aria-expanded={confirming}
      aria-label={`Archive Quick round: ${event.name}`} onClick={() => { setConfirming(true); }}>Archive</button>
    {confirming && <div className="quick-archive-confirmation" role="group" aria-labelledby={title}>
      <h3 ref={heading} id={title} tabIndex={-1}>Archive {event.name}?</h3>
      <p>This removes the round from the public list and stops public scoring and editing. Saved scores and history are retained. There is no public restore action.</p>
      {error && <p role="alert">{error}</p>}
      <div className="quick-actions">
        <button type="button" disabled={disabled || busy || conflict} onClick={() => { void submit(); }}>
          {busy ? 'Archiving...' : attempt ? 'Retry archive' : 'Archive round'}
        </button>
        <button type="button" disabled={busy} onClick={() => { setConfirming(false); trigger.current?.focus(); }}>
          {attempt ? 'Close confirmation' : 'Cancel archive'}
        </button>
        {error && <button type="button" disabled={busy} onClick={onRefresh}>Refresh &amp; review archive</button>}
      </div>
    </div>}
  </div>;
}
