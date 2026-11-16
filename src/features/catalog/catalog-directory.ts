export interface CatalogDirectoryPage<T> {
  readonly entries: readonly T[];
  readonly continuationToken?: string | undefined;
}

export interface CatalogDirectoryProgress<T> {
  readonly entries: Map<string, T>;
  readonly seen: Set<string>;
  cursor: string | undefined;
  complete: boolean;
}

export function catalogDirectoryProgress<T>(): CatalogDirectoryProgress<T> {
  return { entries: new Map<string, T>(), seen: new Set<string>(), cursor: undefined, complete: false };
}

export async function readCatalogDirectory<T extends { readonly id: string }>(
  read: (cursor?: string) => Promise<CatalogDirectoryPage<T>>,
  progress: CatalogDirectoryProgress<T>,
  signal: AbortSignal,
  onPage: (entries: readonly T[], complete: boolean) => void,
): Promise<void> {
  do {
    signal.throwIfAborted();
    const page = await read(progress.cursor);
    signal.throwIfAborted();
    const next = page.continuationToken;
    if (next && progress.seen.has(next)) throw new Error('Invalid catalog paging response. Loaded progress retained.');
    for (const entry of page.entries) progress.entries.set(entry.id, entry);
    if (next) progress.seen.add(next);
    progress.cursor = next;
    progress.complete = !next;
    onPage([...progress.entries.values()], progress.complete);
  } while (!progress.complete);
}
