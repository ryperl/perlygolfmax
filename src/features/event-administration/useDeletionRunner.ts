import { useCallback, useEffect, useRef, useState } from 'react';
import { RateLimitedError } from '../../client/event-administration';
import type { EventAdministrationClient } from '../../client/event-administration';
import { EventChangedError, SessionExpiredError } from '../../client/events';
import type { EventDeletionProgress, EventDeletionResult } from '../../domain/event-administration';

/**
 * Request pacing for automatic deletion. Each request already does several seconds of
 * cleanup on the server, so most events finish in one or two requests. The spacing keeps
 * a very large event under the API's limit of 10 organizer actions a minute.
 */
export interface DeletionPacing {
  readonly spacingMs: number;
  readonly retryDelaysMs: readonly number[];
  readonly rateLimitWaitMs: number;
}

export const defaultDeletionPacing: DeletionPacing = {
  spacingMs: 6_500,
  retryDelaysMs: [3_000, 10_000],
  rateLimitWaitMs: 60_000,
};

type DeletionRequest = (signal: AbortSignal) => Promise<EventDeletionResult>;

export interface DeletionRunner {
  readonly running: boolean;
  /** True once the server has acknowledged a deletion job for this event. */
  readonly started: boolean;
  readonly progress: EventDeletionProgress | undefined;
  /** What the running deletion is doing right now, for the status line. */
  readonly status: string;
  readonly error: string;
  /** Sends `first`, then keeps continuing the same job until it finishes, fails or is stopped. */
  readonly run: (first: DeletionRequest) => Promise<void>;
}

/** Resolves after `ms`, or immediately when the signal aborts. */
function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (ms <= 0 || signal.aborted) { resolve(); return; }
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
  });
}

/** Errors that retrying the same request cannot fix. */
function isFinalError(reason: unknown): boolean {
  return reason instanceof SessionExpiredError || reason instanceof EventChangedError;
}

export function progressMessage(progress: EventDeletionProgress | undefined): string {
  if (!progress) return 'Deleting…';
  if (progress.stage === 'links') return 'Step 1 of 2: removing invitation and sign-in links…';
  if (progress.stage === 'records') return `Step 2 of 2: removing event records (${String(progress.removed)} removed so far)…`;
  return `Finished: ${String(progress.removed)} event records removed.`;
}

export function useDeletionRunner(client: EventAdministrationClient, eventId: string, requestId: string,
  onDeleted: (eventId: string, removed?: number) => void, pacing: DeletionPacing = defaultDeletionPacing,
  initiallyStarted = false): DeletionRunner {
  const [running, setRunning] = useState(false);
  const [started, setStarted] = useState(initiallyStarted);
  const [progress, setProgress] = useState<EventDeletionProgress>();
  const [error, setError] = useState('');
  const [waitingFor, setWaitingFor] = useState<'limit' | 'retry'>();
  const controller = useRef<AbortController | undefined>(undefined);
  const active = useRef(false);
  useEffect(() => () => { controller.current?.abort(); }, []);

  // Closing the page mid-deletion is safe (it can be resumed), but warn anyway.
  useEffect(() => {
    if (!running) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => { window.removeEventListener('beforeunload', warn); };
  }, [running]);

  const run = useCallback(async (first: DeletionRequest) => {
    if (active.current) return;
    active.current = true;
    const abort = new AbortController();
    controller.current = abort;
    const { signal } = abort;
    // A function, so TypeScript re-checks it after each await instead of narrowing it to false.
    const stopped = () => signal.aborted;
    setRunning(true);
    setError('');
    let request = first;
    let failures = 0;
    let lastSentAt: number | undefined;
    try {
      for (;;) {
        if (lastSentAt !== undefined) await pause(lastSentAt + pacing.spacingMs - Date.now(), signal);
        if (stopped()) return;
        lastSentAt = Date.now();
        try {
          const result = await request(signal);
          if (stopped()) return;
          failures = 0;
          setWaitingFor(undefined);
          setStarted(true);
          setProgress(result.progress);
          if (result.state === 'deleted') { onDeleted(eventId, result.progress?.removed); return; }
          request = (next) => client.continueDeletion(eventId, requestId, next);
        } catch (reason) {
          if (stopped()) return;
          const retriesLeft = failures < pacing.retryDelaysMs.length;
          if (isFinalError(reason) || !retriesLeft) {
            setError(reason instanceof Error ? reason.message : 'Deletion could not be confirmed. Resume to try again.');
            return;
          }
          const limited = reason instanceof RateLimitedError;
          const wait = limited ? pacing.rateLimitWaitMs : pacing.retryDelaysMs[failures] ?? 0;
          failures++;
          setWaitingFor(limited ? 'limit' : 'retry');
          await pause(wait, signal);
        }
      }
    } finally {
      active.current = false;
      if (!stopped()) { setRunning(false); setWaitingFor(undefined); }
    }
  }, [client, eventId, onDeleted, pacing, requestId]);

  const status = waitingFor === 'limit' ? 'Request limit reached. Waiting a minute, then continuing automatically…'
    : waitingFor === 'retry' ? 'The last request failed. Retrying shortly…' : progressMessage(progress);
  return { running, started, progress, status, error, run };
}
