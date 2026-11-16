import { useCallback, useEffect, useRef, useState } from 'react';
import type { CatalogClient } from '../../client/catalog';
import { readCourseSource } from '../../contracts/course-import';
import type { CourseCatalogEntry, CourseData, CourseImportSession, CourseVersion } from '../../domain/catalog';
import { useOperation } from './useOperation';
import { TeeProfileSelector } from './TeeProfilePreview';
import { catalogDirectoryProgress, readCatalogDirectory } from './catalog-directory';
import './catalog.css';

interface ImportDraft {
  readonly data: CourseData;
  readonly requestId: string;
  readonly source: string;
  readonly exportedAt: string | null;
}

export function CoursesCatalog({ client }: { readonly client: CatalogClient }) {
  const [identity, setIdentity] = useState({ client, generation: 0 });
  if (identity.client !== client) setIdentity({ client, generation: identity.generation + 1 });
  return <CoursesCatalogSession key={identity.generation} client={client} />;
}

function CoursesCatalogSession({ client }: { readonly client: CatalogClient }) {
  const [courses, setCourses] = useState<readonly CourseCatalogEntry[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [settledClient, setSettledClient] = useState<CatalogClient | null>(null);
  const initialPending = settledClient !== client;
  const [data, setData] = useState<CourseData | null>(null);
  const [source, setSource] = useState('Organizer-provided course export');
  const [exportedAt, setExportedAt] = useState('');
  const [session, setSession] = useState<CourseImportSession | null>(null);
  const [approved, setApproved] = useState(false);
  const [fileKey, setFileKey] = useState(0);
  const [inspected, setInspected] = useState<CourseVersion | null>(null);
  const [panel, setPanel] = useState<'import' | 'version'>();
  const [query, setQuery] = useState('');
  const [catalogComplete, setCatalogComplete] = useState(false);
  const [importTarget, setImportTarget] = useState<CourseCatalogEntry>();
  const [fileReading, setFileReading] = useState(false);
  const directory = useRef(catalogDirectoryProgress<CourseCatalogEntry>());
  const heading = useRef<HTMLHeadingElement>(null);
  const returnTo = useRef<HTMLButtonElement | null>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const draft = useRef<ImportDraft | null>(null);
  const publicationRevision = useRef<{ readonly importId: string; readonly etag: string | null } | null>(null);
  const fileRead = useRef(0);
  const operation = useOperation();
  const { busy, notice, conflict, run, setNotice, setConflict } = operation;

  const list = useCallback(async (signal: AbortSignal, resume = false) => {
    if (!resume) directory.current = catalogDirectoryProgress();
    await readCatalogDirectory(async (cursor) => {
      const page = await client.courses(signal, cursor);
      return { entries: page.courses, continuationToken: page.continuationToken };
    }, directory.current, signal, (entries, complete) => { setCourses(entries); setCatalogComplete(complete); });
    setLoadError('');
  }, [client]);
  useEffect(() => { if (panel) heading.current?.focus(); }, [panel, inspected]);
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        await list(controller.signal);
      } catch (error) {
        if (!controller.signal.aborted) setLoadError(error instanceof Error ? error.message : 'Could not load courses.');
      } finally {
        if (!controller.signal.aborted) setSettledClient(client);
      }
    })();
    return () => { controller.abort(); fileRead.current += 1; };
  }, [client, list]);

  const courseId = data ? `ghin:${String(data.facility.id)}:${String(data.sourceId)}` : '';
  const current = courses?.find((course) => course.id === courseId);
  const complete = session !== null && data !== null && data.teeProfiles.every((profile) => session.profilesReceived.includes(profile.id));
  const hasDraft = data !== null || session !== null || draft.current !== null || fileReading;
  const matches = catalogComplete ? courses?.filter((course) => `${course.name} ${course.location}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())) : courses;
  function openImport(button: HTMLButtonElement, target?: CourseCatalogEntry) {
    returnTo.current = button;
    if (hasDraft) {
      if (target && target.id !== (importTarget?.id ?? courseId)) setNotice('An import draft is already open. Resume it or explicitly start a different import first.');
    } else { setImportTarget(target); fileRead.current += 1; }
    setPanel('import');
  }
  function closePanel() { setPanel(undefined); (returnTo.current?.isConnected ? returnTo.current : addButton.current)?.focus(); }

  return <section className="catalog-view">
    <header className="catalog-heading"><div><p className="catalog-eyebrow">Organizer catalog</p><h1>Courses</h1></div>
      <div className="catalog-toolbar"><button ref={addButton} className="catalog-primary" disabled={busy} onClick={(event) => { openImport(event.currentTarget); }}
        aria-expanded={panel === 'import'} aria-controls="course-import-editor">{hasDraft ? 'Resume import' : 'Add course'}</button>
    <button aria-label="Refresh course catalog" disabled={busy || initialPending} onClick={() => { void run(async (signal) => {
      if (catalogComplete) { setCourses(null); setCatalogComplete(false); }
      try { await list(signal, !catalogComplete); }
      catch (error) {
        if (!signal.aborted) setLoadError(error instanceof Error ? error.message : 'Could not load courses.');
        throw error;
      }
      const reconciled = session ? await client.importStatus(session.id, signal) : null;
      if (!signal.aborted) {
        setApproved(false); setConflict(false);
        if (reconciled) setSession(reconciled);
        setNotice(reconciled?.publishedVersionId
          ? 'Course version was already saved. Catalog refreshed; no publication was repeated.'
          : reconciled ? 'Catalog refreshed. Review the current revision and approve publication again.' : 'Course catalog refreshed.');
      }
    }); }}>Refresh</button></div></header>
    <label className="catalog-search">Search courses<input type="search" value={query} onChange={(event) => { setQuery(event.target.value); }} placeholder="Course or location" /></label>
    {courses === null && !loadError && <p role="status">Loading courses...</p>}
    {loadError && <p role="alert">{loadError}</p>}
    {!catalogComplete && courses && <p role="status">{courses.length} courses loaded · catalog incomplete. {loadError ? 'Refresh to continue loading before searching or publishing.' : 'Loading remaining pages...'}</p>}
    <div className="catalog-workspace" data-editor-open={panel !== undefined || undefined}>
    <div className="catalog-directory">
    {catalogComplete && <p className="catalog-count">{matches?.length ?? 0} of {courses?.length ?? 0} courses</p>}
    {catalogComplete && courses?.length === 0 && <p>No saved courses.</p>}
    {catalogComplete && courses?.length !== 0 && matches?.length === 0 && <p>No courses match your search.</p>}
    <ul className="catalog-list" aria-label="Saved courses">{(!query.trim() || catalogComplete) && matches?.map((course) => <li className="catalog-row" key={course.id}>
      <div><h2>{course.name}</h2><p>{course.location}</p></div>
      <div className="catalog-row-actions"><button aria-label={`View ${course.name} version`} disabled={busy || initialPending || !catalogComplete} onClick={(event) => {
        returnTo.current = event.currentTarget; setPanel('version'); setInspected(null);
        void run(async (signal) => {
        const version = await client.version(course.id, course.currentVersionId, signal);
        if (!signal.aborted) setInspected(version);
      }); }}>View</button>
      <button aria-label={`Update ${course.name}`} disabled={busy || initialPending || !catalogComplete}
        onClick={(event) => { openImport(event.currentTarget, course); }}>Update</button></div>
    </li>)}</ul>
    </div>
    <div className="catalog-editor" hidden={panel === undefined}>
    {panel === 'version' && <section className="catalog-form" aria-label="Published course version">
      <div className="catalog-editor-heading"><h2 ref={heading} tabIndex={-1}>{inspected?.data.name ?? 'Course details'}</h2>
        <button disabled={busy} onClick={closePanel}>Close course details</button></div>
      {busy && !inspected && <p role="status">Loading course version...</p>}
      {inspected && <>
      <p>Source: {inspected.provenance.source}. Export date: {inspected.provenance.exportedAt ?? 'unknown; freshness unknown'}.</p>
      <details className="catalog-technical"><summary>Version details</summary><p className="catalog-version">{inspected.id}</p>
        <p>Imported at: {inspected.importedAt}. Import time does not establish source freshness.</p></details>
      <TeeProfileSelector key={inspected.id} profiles={inspected.data.teeProfiles} />
      <p>Profiles are independent. This preview does not select a tee for any round.</p>
      </>}
    </section>}
    <form id="course-import-editor" className="catalog-form" hidden={panel !== 'import'} onSubmit={(event) => {
      event.preventDefault();
      if (!data || !courses || initialPending || !catalogComplete || conflict || importTarget && courseId !== importTarget.id) return;
      void run(async (signal) => {
        draft.current ??= { data, source: source.trim(), exportedAt: exportedAt || null, requestId: crypto.randomUUID() };
        const pending = draft.current;
        const { teeProfiles, ...course } = pending.data;
        let staged = session
          ? await client.importStatus(session.id, signal)
          : await client.beginImport({ course, teeProfileIds: teeProfiles.map((profile) => profile.id),
            provenance: { source: pending.source, exportedAt: pending.exportedAt } }, pending.requestId, signal);
        signal.throwIfAborted();
        setSession(staged);
        if (staged.publishedVersionId) {
          setNotice('Course version was already saved. Refresh the catalog.');
          return;
        }
        for (const profile of teeProfiles) {
          if (staged.profilesReceived.includes(profile.id)) continue;
          staged = await client.uploadProfile(staged.id, profile, signal);
          signal.throwIfAborted();
          setSession(staged);
        }
        setNotice('All profiles staged. Review and explicitly approve publication. Nothing is selectable yet.');
      });
    }}>
      <div className="catalog-editor-heading"><h2 ref={panel === 'import' ? heading : undefined} tabIndex={-1}>{importTarget ? `Update ${importTarget.name}` : 'Add a course'}</h2>
        <button type="button" disabled={busy} onClick={closePanel}>Close import</button></div>
      <ol className="catalog-steps" role="list" aria-label="Course import steps"><li aria-current={!data ? 'step' : undefined}>Choose export</li>
        <li aria-current={data && !complete ? 'step' : undefined}>Review and stage</li><li aria-current={complete ? 'step' : undefined}>Publish</li></ol>
      <fieldset disabled={busy || draft.current !== null}>
        <label>Course JSON file<input key={fileKey} type="file" accept=".json,application/json" onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          const sequence = ++fileRead.current;
          setData(null); setSession(null); setApproved(false); setFileReading(false);
          if (!file) { setFileReading(false); return; }
          if (file.size > 1_000_000) { setNotice('Course file exceeds the 1 MB local import limit. Nothing was imported.'); return; }
          setFileReading(true);
          void file.text().then((text) => {
            if (sequence !== fileRead.current) return;
            let value: unknown;
            try { value = JSON.parse(text); }
            catch { throw new Error('Selected file is not valid JSON. Nothing was imported.'); }
            const parsed = readCourseSource(value);
            if (importTarget && `ghin:${String(parsed.facility.id)}:${String(parsed.sourceId)}` !== importTarget.id) {
              throw new Error('This export belongs to a different course. Choose the correct file or start a different import.');
            }
            setData(parsed); setNotice('File validated locally. Review all profiles before staging.');
          }).catch((error: unknown) => {
            if (sequence === fileRead.current) setNotice(error instanceof Error ? error.message : 'Could not read the selected course file.');
          }).finally(() => { if (sequence === fileRead.current) setFileReading(false); });
        }} /></label>
        <label>Source label<input required maxLength={300} value={source} onChange={(event) => { setSource(event.target.value); }} /></label>
        <label>Export date (optional)<input type="date" value={exportedAt} onChange={(event) => { setExportedAt(event.target.value); }} /></label>
      </fieldset>
      {data && <div>
        <h3>{data.name} — {data.city}, {data.state}</h3>
        <p>{data.teeProfiles.length} independent tee profiles. Export date: {exportedAt || 'unknown; freshness unknown'}.</p>
        <TeeProfileSelector key={fileRead.current} profiles={data.teeProfiles} />
        <p className="catalog-hint">{current ? 'A new version of this saved course.' : 'New saved course.'}</p>
        <details className="catalog-technical"><summary>Import version details</summary>
          <p className="catalog-version">{current ? `Updating saved course; current revision ${current.etag}, version ${current.currentVersionId}.` : 'New saved course (no current revision).'}</p>
        </details>
      </div>}
      {session && <><p>{session.profilesReceived.length} of {session.manifest.teeProfileIds.length} profiles received. {session.publishedVersionId ? 'Already published; refresh catalog.' : 'Staged only.'}</p>
        <details className="catalog-technical"><summary>Import technical details</summary><p className="catalog-version">Import {session.id}</p></details></>}
      {session && <button type="button" disabled={busy || initialPending} onClick={() => { void run(async (signal) => {
        const reconciled = await client.importStatus(session.id, signal);
        if (signal.aborted) return;
        setSession(reconciled);
        if (reconciled.publishedVersionId) { setApproved(false); setConflict(false); }
        setNotice(reconciled.publishedVersionId
          ? 'Course version was already saved. No publication was repeated.'
          : 'Import status refreshed. Profiles remain staged only; review catalog revision before publication.');
      }); }}>Refresh staged import status</button>}
      <button type="submit" disabled={busy || initialPending || !catalogComplete || fileReading || !data || courses === null || complete || conflict}>{session ? 'Resume staged import' : 'Stage import'}</button>
      {complete && !session.publishedVersionId && <>
        <label className="catalog-check"><input type="checkbox" checked={approved} disabled={busy || !catalogComplete || conflict} onChange={(event) => {
          setApproved(event.target.checked);
          if (event.target.checked) publicationRevision.current = { importId: session.id, etag: current?.etag ?? null };
        }} />
          I approve publishing these profiles against {current ? `current revision ${current.etag}` : 'no existing course revision'}.
        </label>
        <button type="button" disabled={busy || !catalogComplete || !approved || conflict} onClick={() => {
          void run(async (signal) => {
            const reconciled = await client.importStatus(session.id, signal);
            signal.throwIfAborted();
            setSession(reconciled);
            if (reconciled.publishedVersionId) {
              setApproved(false); setConflict(false);
              setNotice('Course version was already saved. No publication was repeated.');
              return;
            }
            if (!reconciled.manifest.teeProfileIds.every((id) => reconciled.profilesReceived.includes(id))) {
              setApproved(false);
              throw new Error('Staged profiles are incomplete. Resume staged import before publishing.');
            }
            const revision = publicationRevision.current;
            if (!revision || revision.importId !== session.id) throw new Error('Review the catalog revision and approve publication again.');
            const version = await client.publish(session.id, revision.etag, signal);
            signal.throwIfAborted();
            if (version.courseId !== session.courseId) throw new Error('Publication returned a different course. Refresh the catalog before retrying.');
            setSession({ ...session, publishedVersionId: version.id }); setApproved(false);
            setNotice('Course version successfully saved. Refresh the catalog to select this version.');
          });
        }}>Publish staged version</button>
      </>}
      <button type="button" disabled={busy} onClick={() => {
        fileRead.current += 1; draft.current = null; publicationRevision.current = null; setData(null); setSession(null); setApproved(false); setFileReading(false); setImportTarget(undefined); setFileKey((previous) => previous + 1);
        setNotice('Local import draft cleared. Previously staged data is not published by this action.');
      }}>Start a different import</button>
    </form>
    </div></div>
    <p role={conflict ? 'alert' : 'status'}>{busy ? 'Working...' : notice || (conflict ? 'Course changed. Refresh the catalog and review before approving publication again.' : '')}</p>
  </section>;
}
