import { useEffect, useRef, useState } from 'react';
import type { CatalogClient } from '../../client/catalog';
import { readCourseSource } from '../../contracts/course-import';
import type { CourseCatalogEntry, CourseData, CourseImportSession, CourseVersion } from '../../domain/catalog';
import { useOperation } from './useOperation';
import { TeeProfileSelector } from './TeeProfilePreview';
import './catalog.css';

interface ImportDraft {
  readonly data: CourseData;
  readonly requestId: string;
  readonly source: string;
  readonly exportedAt: string | null;
}

export function CoursesCatalog({ client }: { readonly client: CatalogClient }) {
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
  const draft = useRef<ImportDraft | null>(null);
  const publicationRevision = useRef<{ readonly importId: string; readonly etag: string | null } | null>(null);
  const fileRead = useRef(0);
  const operation = useOperation();
  const { busy, notice, conflict, run, setNotice, setConflict } = operation;

  async function list(signal: AbortSignal) {
    const entries: CourseCatalogEntry[] = [];
    const seen = new Set<string>();
    let cursor: string | undefined;
    do {
      const page = await client.courses(signal, cursor);
      entries.push(...page.courses);
      cursor = page.continuationToken;
      if (cursor && seen.has(cursor)) throw new Error('Invalid catalog paging response.');
      if (cursor) seen.add(cursor);
    } while (cursor);
    return entries;
  }
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const entries: CourseCatalogEntry[] = [];
        const seen = new Set<string>();
        let cursor: string | undefined;
        do {
          const page = await client.courses(controller.signal, cursor);
          entries.push(...page.courses);
          cursor = page.continuationToken;
          if (cursor && seen.has(cursor)) throw new Error('Invalid catalog paging response.');
          if (cursor) seen.add(cursor);
        } while (cursor);
        if (!controller.signal.aborted) { setCourses(entries); setLoadError(''); }
      } catch (error) {
        if (!controller.signal.aborted) setLoadError(error instanceof Error ? error.message : 'Could not load courses.');
      } finally {
        if (!controller.signal.aborted) setSettledClient(client);
      }
    })();
    return () => { controller.abort(); fileRead.current += 1; };
  }, [client]);

  const courseId = data ? `ghin:${String(data.facility.id)}:${String(data.sourceId)}` : '';
  const current = courses?.find((course) => course.id === courseId);
  const complete = session !== null && data !== null && data.teeProfiles.every((profile) => session.profilesReceived.includes(profile.id));

  return <section className="catalog-view">
    <h1>Saved course catalog</h1>
    <p>Manager-only reusable course versions. A staged import is not saved or selectable until publication. No default tee is selected.</p>
    {courses === null && !loadError && <p role="status">Loading courses...</p>}
    {loadError && <p role="alert">{loadError}</p>}
    <button disabled={busy || initialPending} onClick={() => { void run(async (signal) => {
      const entries = await list(signal);
      const reconciled = session ? await client.importStatus(session.id, signal) : null;
      if (!signal.aborted) {
        setCourses(entries); setLoadError(''); setApproved(false); setConflict(false);
        if (reconciled) setSession(reconciled);
        setNotice(reconciled?.publishedVersionId
          ? `Course version ${reconciled.publishedVersionId} was already saved. Catalog refreshed; no publication was repeated.`
          : 'Catalog refreshed. Review the current revision and approve publication again.');
      }
    }); }}>Refresh course catalog</button>
    {courses?.length === 0 && <p>No saved courses.</p>}
    <ul className="round-list">{courses?.map((course) => <li className="panel" key={course.id}>
      <h2>{course.name}</h2><p>{course.location}</p><p className="catalog-version">Current version: {course.currentVersionId}</p>
      <button disabled={busy} onClick={() => { void run(async (signal) => {
        const version = await client.version(course.id, course.currentVersionId, signal);
        if (!signal.aborted) setInspected(version);
      }); }}>View {course.name} version</button>
    </li>)}</ul>
    {inspected && <section className="panel" aria-label="Published course version">
      <h2>{inspected.data.name} — published version</h2>
      <p className="catalog-version">{inspected.id}</p>
      <p>Source: {inspected.provenance.source}. Export date: {inspected.provenance.exportedAt ?? 'unknown; freshness unknown'}.</p>
      <p>Imported at: {inspected.importedAt}. Import time does not establish source freshness.</p>
      <TeeProfileSelector key={inspected.id} profiles={inspected.data.teeProfiles} />
      <p>Profiles are independent. This preview does not select a tee for any round.</p>
    </section>}
    <form className="panel catalog-form" onSubmit={(event) => {
      event.preventDefault();
      if (!data || !courses || initialPending || conflict) return;
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
          setNotice(`Course version ${staged.publishedVersionId} was already saved. Refresh the catalog.`);
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
      <h2>Import a course export</h2>
      <fieldset disabled={busy || draft.current !== null}>
        <label>Course JSON file<input key={fileKey} type="file" accept=".json,application/json" onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          const sequence = ++fileRead.current;
          setData(null); setSession(null); setApproved(false);
          if (!file) return;
          if (file.size > 1_000_000) { setNotice('Course file exceeds the 1 MB local import limit. Nothing was imported.'); return; }
          void file.text().then((text) => {
            if (sequence !== fileRead.current) return;
            let value: unknown;
            try { value = JSON.parse(text); }
            catch { throw new Error('Selected file is not valid JSON. Nothing was imported.'); }
            setData(readCourseSource(value)); setNotice('File validated locally. Review all profiles before staging.');
          }).catch((error: unknown) => {
            if (sequence === fileRead.current) setNotice(error instanceof Error ? error.message : 'Could not read the selected course file.');
          });
        }} /></label>
        <label>Source label<input required maxLength={300} value={source} onChange={(event) => { setSource(event.target.value); }} /></label>
        <label>Export date (optional)<input type="date" value={exportedAt} onChange={(event) => { setExportedAt(event.target.value); }} /></label>
      </fieldset>
      {data && <div>
        <h3>{data.name} — {data.city}, {data.state}</h3>
        <p>{data.teeProfiles.length} independent tee profiles. Export date: {exportedAt || 'unknown; freshness unknown'}.</p>
        <TeeProfileSelector key={fileRead.current} profiles={data.teeProfiles} />
        <p className="catalog-version">{current ? `Updating saved course; current revision ${current.etag}, version ${current.currentVersionId}.` : 'New saved course (no current revision).'}</p>
      </div>}
      {session && <p>Import {session.id}: {session.profilesReceived.length} profiles received. {session.publishedVersionId ? 'Already published; refresh catalog.' : 'Staged only.'}</p>}
      {session && <button type="button" disabled={busy || initialPending} onClick={() => { void run(async (signal) => {
        const reconciled = await client.importStatus(session.id, signal);
        if (signal.aborted) return;
        setSession(reconciled);
        if (reconciled.publishedVersionId) { setApproved(false); setConflict(false); }
        setNotice(reconciled.publishedVersionId
          ? `Course version ${reconciled.publishedVersionId} was already saved. No publication was repeated.`
          : 'Import status refreshed. Profiles remain staged only; review catalog revision before publication.');
      }); }}>Refresh staged import status</button>}
      <button type="submit" disabled={busy || initialPending || !data || courses === null || complete || conflict}>{session ? 'Resume staged import' : 'Stage import'}</button>
      {complete && !session.publishedVersionId && <>
        <label className="catalog-check"><input type="checkbox" checked={approved} disabled={busy || conflict} onChange={(event) => {
          setApproved(event.target.checked);
          if (event.target.checked) publicationRevision.current = { importId: session.id, etag: current?.etag ?? null };
        }} />
          I approve publishing these profiles against {current ? `current revision ${current.etag}` : 'no existing course revision'}.
        </label>
        <button type="button" disabled={busy || !approved || conflict} onClick={() => {
          void run(async (signal) => {
            const reconciled = await client.importStatus(session.id, signal);
            signal.throwIfAborted();
            setSession(reconciled);
            if (reconciled.publishedVersionId) {
              setApproved(false); setConflict(false);
              setNotice(`Course version ${reconciled.publishedVersionId} was already saved. No publication was repeated.`);
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
            setNotice(`Course version ${version.id} saved. Refresh the catalog to select this version.`);
          });
        }}>Publish staged version</button>
      </>}
      <button type="button" disabled={busy} onClick={() => {
        fileRead.current += 1; draft.current = null; publicationRevision.current = null; setData(null); setSession(null); setApproved(false); setFileKey((previous) => previous + 1);
        setNotice('Local import draft cleared. Previously staged data is not published by this action.');
      }}>Start a different import</button>
    </form>
    <p role={conflict ? 'alert' : 'status'}>{busy ? 'Working...' : notice}</p>
  </section>;
}
