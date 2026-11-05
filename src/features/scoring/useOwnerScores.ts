import { useCallback, useEffect, useRef, useState } from 'react';
import type { ScoresClient } from '../../client/scoring';
import { SessionExpiredError } from '../../client/events';
import { PrivateRequestError } from '../../client/private-request';
import type { RoundScores } from '../../domain/scoring';
import { scoreAccessKey } from './score-access';

interface ActiveOperation {
  readonly controller: AbortController;
  readonly background: boolean;
  readonly finished: Promise<void>;
  readonly finish: () => void;
  discardProjection: boolean;
}

export function useOwnerScores(client: ScoresClient, eventId: string, roundId: string, dirty: boolean,
  onSessionExpired: (message: string) => void) {
  const [round, setRound] = useState<RoundScores | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [stale, setStale] = useState(true);
  const [refreshedAt, setRefreshedAt] = useState<string | null>(null);
  const projectionKey = useRef<string | null>(null);
  const accessKey = useRef<string | null>(null);
  const latestRound = useRef<RoundScores | null>(null);
  const active = useRef<ActiveOperation | null>(null);
  const foreground = useRef<object | null>(null);
  const dirtyNow = useRef(dirty);
  const mounted = useRef(false);
  const failures = useRef(0);
  const retryAt = useRef(0);
  const serverRetryAt = useRef(0);
  const expired = useRef(false);
  const denied = useRef(false);
  const resumeRequested = useRef(false);
  const resumeWake = useRef<(() => void) | null>(null);
  const expiryHandler = useRef(onSessionExpired);
  useEffect(() => { expiryHandler.current = onSessionExpired; }, [onSessionExpired]);

  const pauseForEdit = useCallback(() => {
    dirtyNow.current = true;
    if (active.current?.background) active.current.discardProjection = true;
  }, []);
  useEffect(() => {
    dirtyNow.current = dirty;
    if (dirty && active.current?.background) active.current.discardProjection = true;
  }, [dirty]);

  const perform = useCallback(async <T,>(work: (signal: AbortSignal) => Promise<T>, background = false, allowDenied = false, allowDirtyRead = false): Promise<T | null> => {
    const available = () => mounted.current && !expired.current && (!denied.current || allowDenied) && Date.now() >= serverRetryAt.current;
    if (!available() || foreground.current || background && dirtyNow.current && !allowDirtyRead) return null;
    const previous = active.current;
    if (previous && (background || !previous.background)) return null;
    const ticket = {};
    if (!background) { foreground.current = ticket; setBusy(true); }
    let operation: ActiveOperation | undefined;
    try {
      if (previous) {
        // A user operation takes priority, but never overlaps the pending read.
        previous.discardProjection = true;
        await previous.finished;
      }
      if (!available() || !background && foreground.current !== ticket) return null;
      let finish: (() => void) | undefined;
      const finished = new Promise<void>((resolve) => { finish = resolve; });
      operation = { controller: new AbortController(), background, finished, finish: () => { finish?.(); }, discardProjection: false };
      active.current = operation;
      const value = await work(operation.controller.signal);
      operation.controller.signal.throwIfAborted();
      failures.current = 0;
      retryAt.current = 0;
      serverRetryAt.current = 0;
      setError('');
      denied.current = false;
      return value;
    } catch (failure) {
      if (operation && !operation.controller.signal.aborted && mounted.current) {
        failures.current = Math.min(failures.current + 1, 4);
        const minimumSeconds = failure instanceof PrivateRequestError ? failure.retryAfterSeconds ?? 0 : 0;
        serverRetryAt.current = Date.now() + minimumSeconds * 1000;
        retryAt.current = Date.now() + Math.max(15_000 * 2 ** failures.current, minimumSeconds * 1000);
        setStale(true);
        const message = failure instanceof Error ? failure.message : 'Connection failed. Nothing was confirmed saved.';
        setError(minimumSeconds > 0 ? `${message} Wait at least ${String(minimumSeconds)} seconds before retrying.` : message);
        if (failure instanceof PrivateRequestError && (failure.status === 403 || failure.status === 404)) {
          denied.current = true;
          projectionKey.current = null;
          latestRound.current = null;
          setRound(null);
        }
        if (failure instanceof SessionExpiredError) {
          expired.current = true;
          projectionKey.current = null;
          latestRound.current = null;
          setRound(null);
          expiryHandler.current(message);
        }
      }
      throw failure;
    } finally {
      if (operation) {
        if (active.current === operation) active.current = null;
        operation.finish();
      }
      if (!background && foreground.current === ticket) {
        foreground.current = null;
        if (mounted.current) setBusy(false);
      }
      resumeWake.current?.();
    }
  }, []);
  const run = useCallback(<T,>(work: (signal: AbortSignal) => Promise<T>) => perform(work), [perform]);

  const accept = useCallback((value: RoundScores) => {
    if (!mounted.current || expired.current) return;
    const key = JSON.stringify(value);
    latestRound.current = value;
    if (key !== projectionKey.current) {
      projectionKey.current = key;
      accessKey.current = scoreAccessKey(value);
      setRound(value);
    }
    setStale(false);
    setRefreshedAt(new Date().toISOString());
  }, []);
  const load = useCallback((background: boolean, resume = false) => perform(async (signal) => {
    const value = await client.load(eventId, roundId, signal);
    signal.throwIfAborted();
    const unchanged = JSON.stringify(value) === projectionKey.current;
    // Keep an edit-time baseline and the focused field intact if typing started
    // after this poll began. Authorization errors still flow through perform.
    if (background && scoreAccessKey(value) === accessKey.current && ((!resume && dirtyNow.current) || active.current?.discardProjection) && !unchanged) setStale(true);
    else accept(value);
    return value;
  }, background, !background, resume), [accept, client, eventId, roundId, perform]);
  const refresh = useCallback(() => load(false), [load]);

  useEffect(() => {
    let hidden = document.hidden;
    function wake() {
      if (!resumeRequested.current || !mounted.current || document.hidden || active.current || foreground.current
        || expired.current || denied.current || Date.now() < retryAt.current) return;
      resumeRequested.current = false;
      // Re-read on real return, including with drafts. Drafts remain separate from
      // the server projection; conditional writes still require their captured etags.
      void load(true, true).catch(() => undefined);
    }
    function visibility() {
      const wasHidden = hidden;
      hidden = document.hidden;
      if (wasHidden && !hidden) { resumeRequested.current = true; wake(); }
    }
    function pageshow(event: PageTransitionEvent) {
      if (event.persisted) { resumeRequested.current = true; wake(); }
    }
    resumeWake.current = wake;
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('pageshow', pageshow);
    return () => {
      resumeWake.current = null;
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('pageshow', pageshow);
    };
  }, [load]);

  useEffect(() => {
    mounted.current = true;
    expired.current = false;
    void refresh().catch(() => undefined);
    return () => {
      mounted.current = false;
      active.current?.controller.abort();
      active.current?.finish();
      active.current = null;
      foreground.current = null;
    };
  }, [refresh]);

  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    function schedule() {
      if (disposed) return;
      timer = setTimeout(() => { void tick(); }, Math.max(15_000, retryAt.current - Date.now()));
    }
    async function tick() {
      if (disposed) return;
      if (resumeRequested.current) resumeWake.current?.();
      if (!dirtyNow.current && !document.hidden && !active.current && !foreground.current && !expired.current && !denied.current && Date.now() >= retryAt.current) {
        try { await load(true); } catch { /* Errors and stale state remain visible. */ }
      }
      schedule();
    }
    schedule();
    return () => { disposed = true; clearTimeout(timer); };
  }, [dirty, load]);

  const currentRound = useCallback(() => latestRound.current, []);
  return { round, busy, error, stale, refreshedAt, run, refresh, accept, pauseForEdit, currentRound };
}
