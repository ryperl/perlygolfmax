import { useCallback, useEffect, useRef, useState } from 'react';
import type { ScoresClient } from '../../client/scoring';
import { SessionExpiredError } from '../../client/events';
import { PrivateRequestError } from '../../client/private-request';
import type { RoundScores } from '../../domain/scoring';

export function useOwnerScores(client: ScoresClient, eventId: string, roundId: string, dirty: boolean,
  onSessionExpired: (message: string) => void) {
  const [round, setRound] = useState<RoundScores | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [stale, setStale] = useState(true);
  const [refreshedAt, setRefreshedAt] = useState<string | null>(null);
  const active = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  const failures = useRef(0);
  const retryAt = useRef(0);
  const serverRetryAt = useRef(0);
  const expired = useRef(false);
  const denied = useRef(false);
  const expiryHandler = useRef(onSessionExpired);
  useEffect(() => { expiryHandler.current = onSessionExpired; }, [onSessionExpired]);

  const run = useCallback(async <T,>(work: (signal: AbortSignal) => Promise<T>): Promise<T | null> => {
    if (!mounted.current || active.current || expired.current || Date.now() < serverRetryAt.current) return null;
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    try {
      const value = await work(controller.signal);
      controller.signal.throwIfAborted();
      failures.current = 0;
      retryAt.current = 0;
      serverRetryAt.current = 0;
      setError('');
      denied.current = false;
      return value;
    } catch (failure) {
      if (!controller.signal.aborted) {
        failures.current = Math.min(failures.current + 1, 4);
        const minimumSeconds = failure instanceof PrivateRequestError ? failure.retryAfterSeconds ?? 0 : 0;
        serverRetryAt.current = Date.now() + minimumSeconds * 1000;
        retryAt.current = Date.now() + Math.max(15_000 * 2 ** failures.current, minimumSeconds * 1000);
        setStale(true);
        const message = failure instanceof Error ? failure.message : 'Connection failed. Nothing was confirmed saved.';
        setError(minimumSeconds > 0 ? `${message} Wait at least ${String(minimumSeconds)} seconds before retrying.` : message);
        if (failure instanceof PrivateRequestError && (failure.status === 403 || failure.status === 404)) {
          denied.current = true;
          setRound(null);
        }
        if (failure instanceof SessionExpiredError) {
          expired.current = true;
          setRound(null);
          expiryHandler.current(message);
        }
      }
      throw failure;
    } finally {
      if (active.current === controller) active.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }, []);

  const accept = useCallback((value: RoundScores) => {
    if (!mounted.current || expired.current) return;
    setRound(value);
    setStale(false);
    setRefreshedAt(new Date().toISOString());
  }, []);
  const refresh = useCallback(async () => {
    const value = await run((signal) => client.load(eventId, roundId, signal));
    if (value) accept(value);
    return value;
  }, [accept, client, eventId, roundId, run]);

  useEffect(() => {
    mounted.current = true;
    expired.current = false;
    void refresh().catch(() => undefined);
    return () => {
      mounted.current = false;
      active.current?.abort();
      active.current = null;
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
      if (!dirty && !document.hidden && !active.current && !expired.current && !denied.current && Date.now() >= retryAt.current) {
        try { await refresh(); } catch { /* The visible error and stale state are set by run. */ }
      }
      schedule();
    }
    schedule();
    return () => { disposed = true; clearTimeout(timer); };
  }, [dirty, refresh]);

  return { round, busy, error, stale, refreshedAt, run, refresh, accept };
}
