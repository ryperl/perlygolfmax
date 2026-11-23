import type { QuickPage } from '../../domain/quick-round';

export interface QuickDirectory<T> {
  readonly items: readonly T[];
  readonly cursor?: string;
  readonly seen: readonly string[];
  readonly complete: boolean;
  readonly publicPlayerCreation?: boolean;
}

export async function loadQuickDirectory<T extends { readonly id: string }>(
  read: (signal: AbortSignal, cursor?: string) => Promise<QuickPage<T>>,
  signal: AbortSignal,
  remember: (progress: QuickDirectory<T>) => void,
  initial?: QuickDirectory<T>,
): Promise<QuickDirectory<T>> {
  let progress: QuickDirectory<T> = initial ?? { items: [], seen: [], complete: false };
  while (!progress.complete) {
    const page = await read(signal, progress.cursor);
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    const cursor = page.continuationToken;
    if (cursor && (cursor === progress.cursor || progress.seen.includes(cursor))) throw new Error('Directory paging repeated. Refresh the directory before searching.');
    const items = new Map(progress.items.map((item) => [item.id, item]));
    for (const item of page.items) items.set(item.id, item);
    const creation = 'publicPlayerCreation' in page && page.publicPlayerCreation === true;
    progress = { items: [...items.values()], ...(cursor ? { cursor } : {}),
      publicPlayerCreation: creation && (progress.publicPlayerCreation ?? true),
      seen: cursor ? [...progress.seen, cursor] : progress.seen, complete: !cursor };
    remember(progress);
  }
  return progress;
}
