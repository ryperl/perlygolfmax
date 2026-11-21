interface BuildMetadata {
  readonly version: string;
  readonly sha: string;
  readonly builtAt: string;
  readonly modified: boolean;
}

declare const __PGM_BUILD__: BuildMetadata;

export function BuildVersion({ metadata = typeof __PGM_BUILD__ === 'undefined' ? undefined : __PGM_BUILD__ }: {
  readonly metadata?: BuildMetadata | undefined;
}) {
  if (!metadata) return <span className="site-version" aria-label="Local development build">Development</span>;
  const id = `${metadata.sha.slice(0, 8)}${metadata.modified ? '-local' : ''}`;
  return <span className="site-version" title={`Build ${metadata.sha} · Built ${metadata.builtAt}${metadata.modified ? ' · Local changes' : ''}`}
    aria-label={`App version ${metadata.version}, build ${id}, built ${metadata.builtAt}`}>
    v{metadata.version} · {id}
  </span>;
}
