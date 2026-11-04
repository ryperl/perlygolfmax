import { useEffect, useRef, useState } from 'react';
import { EventChangedError } from '../../client/events';

export function useOperation() {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [conflict, setConflict] = useState(false);
  const active = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; active.current?.abort(); };
  }, []);
  async function run(work: (signal: AbortSignal) => Promise<void>): Promise<boolean> {
    if (active.current) return false;
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setNotice('');
    try {
      await work(controller.signal);
      return mounted.current && !controller.signal.aborted;
    } catch (error) {
      if (mounted.current && !controller.signal.aborted) {
        setNotice(error instanceof Error ? error.message : 'The operation failed. Nothing was confirmed saved.');
        if (error instanceof EventChangedError) setConflict(true);
      }
      return false;
    } finally {
      active.current = null;
      if (mounted.current && !controller.signal.aborted) setBusy(false);
    }
  }
  return { busy, notice, conflict, run, setNotice, setConflict };
}
