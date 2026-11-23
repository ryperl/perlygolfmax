import { useEffect, useMemo, useRef, useState } from 'react';
import type { QuickPage } from '../../domain/quick-round';
import { loadQuickDirectory } from './quick-directory';
import type { QuickDirectory } from './quick-directory';

export function useQuickDirectory<T extends { readonly id: string }>(
  read: (signal: AbortSignal, cursor?: string) => Promise<QuickPage<T>>,
) {
  const progress = useRef<QuickDirectory<T> | undefined>(undefined);
  const scope = useRef(read);
  const [attempt, setAttempt] = useState(0);
  const generation = useMemo(() => ({ read, attempt }), [read, attempt]);
  const [result, setResult] = useState<{ readonly generation: object; readonly items?: readonly T[]; readonly error?: string; readonly publicPlayerCreation?: boolean }>();
  useEffect(() => {
    const controller = new AbortController();
    if (scope.current !== read) { scope.current = read; progress.current = undefined; }
    void loadQuickDirectory(read, controller.signal, (value) => { progress.current = value; }, progress.current).then((value) => {
      if (!controller.signal.aborted) setResult({ generation, items: value.items, publicPlayerCreation: value.publicPlayerCreation === true });
    }).catch((failure: unknown) => {
      if (!controller.signal.aborted) setResult({ generation, error: failure instanceof Error ? failure.message : 'Directory incomplete. Retry to continue loading.' });
    });
    return () => { controller.abort(); };
  }, [read, generation]);
  return { items: result?.generation === generation ? result.items : undefined, error: result?.generation === generation ? result.error : undefined,
    publicPlayerCreation: result?.generation === generation && result.publicPlayerCreation === true,
    loading: result?.generation !== generation, retry: () => { setAttempt((value) => value + 1); },
    restart: () => { progress.current = undefined; setAttempt((value) => value + 1); } };
}
