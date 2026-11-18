import { createRoot } from 'react-dom/client';
import { useMemo, useState } from 'react';
import { CoursesCatalog, PlayersCatalog } from '../../src/features/catalog';
import type { CatalogClient } from '../../src/client/catalog';
import type { CourseCatalogEntry, CourseImportSession, CourseVersion, IndexObservation, PlayerProfile, TeeProfile } from '../../src/domain/catalog';
import { purseTestId } from '../../src/domain/purse.test-support';
import { catalogPlayers, catalogVersions } from './catalog-workspace-data';
import '../../src/app/styles.css';

function createFictionalCatalog(): CatalogClient {
    const versions = new Map(catalogVersions.map((version) => [`${version.courseId}:${version.id}`, version]));
    let courses: readonly CourseCatalogEntry[] = catalogVersions.map((version) => ({
      id: version.courseId, name: version.data.name, location: 'Fictional County', currentVersionId: version.id, etag: 'course-initial',
    }));
    let players = [...catalogPlayers];
    const histories = new Map<string, readonly IndexObservation[]>(players.map((player) => [player.id, player.currentIndex ? [player.currentIndex] : []]));
    const imports = new Map<string, CourseImportSession>();
    const profiles = new Map<string, Map<number, TeeProfile>>();
    const actor = { tenantId: purseTestId(900), objectId: purseTestId(901) };
    const page = <T,>(entries: readonly T[], cursor?: string) => {
      const start = cursor === undefined ? 0 : Number(cursor);
      if (!Number.isSafeInteger(start) || start < 0) throw new Error('Invalid fictional cursor');
      return { values: entries.slice(start, start + 3),
        ...(start + 3 < entries.length ? { continuationToken: String(start + 3) } : {}) };
    };
    function session(id: string) {
      const found = imports.get(id);
      if (!found) throw new Error('Fictional import missing');
      return found;
    }
    return {
      player: (id) => {
        const found = players.find((player) => player.id === id);
        return found ? Promise.resolve(found) : Promise.reject(new Error('Fictional player missing'));
      },
      refreshEventIndex: () => Promise.reject(new Error('Event HI updates are not implemented by this catalog-only fixture.')),
      courses: (_signal, cursor) => { const result = page(courses, cursor); return Promise.resolve({ courses: result.values, ...('continuationToken' in result ? { continuationToken: result.continuationToken } : {}) }); },
      players: (_signal, cursor) => { const result = page(players, cursor); return Promise.resolve({ players: result.values, ...('continuationToken' in result ? { continuationToken: result.continuationToken } : {}) }); },
      version: (id, versionId) => {
        const found = versions.get(`${id}:${versionId}`);
        return found ? Promise.resolve(found) : Promise.reject(new Error('Fictional version missing'));
      },
      beginImport: (manifest, id) => {
        const existing = imports.get(id);
        if (existing) return Promise.resolve(existing);
        const value: CourseImportSession = { id, manifest, courseId: `ghin:${String(manifest.course.facility.id)}:${String(manifest.course.sourceId)}`,
          profilesReceived: [], publishedVersionId: null };
        imports.set(id, value); profiles.set(id, new Map());
        return Promise.resolve(value);
      },
      importStatus: (id) => Promise.resolve(session(id)),
      uploadProfile: (id, profile) => {
        const found = session(id), stored = profiles.get(id);
        if (!stored) return Promise.reject(new Error('Fictional profile stage missing'));
        stored.set(profile.id, profile);
        const updated = { ...found, profilesReceived: [...stored.keys()] };
        imports.set(id, updated); return Promise.resolve(updated);
      },
      publish: (id, expected) => {
        const found = session(id), stored = profiles.get(id);
        if (!stored || found.manifest.teeProfileIds.some((profile) => !stored.has(profile))) return Promise.reject(new Error('Fictional import incomplete'));
        const current = courses.find((course) => course.id === found.courseId);
        if ((current?.etag ?? null) !== expected) return Promise.reject(new Error('Fictional course revision changed'));
        const version: CourseVersion = { id: 'b'.repeat(64), courseId: found.courseId,
          data: { ...found.manifest.course, teeProfiles: [...stored.values()] }, provenance: found.manifest.provenance, importedAt: '2026-01-02T00:00:00Z' };
        versions.set(`${version.courseId}:${version.id}`, version);
        imports.set(id, { ...found, publishedVersionId: version.id });
        const entry = { id: version.courseId, name: version.data.name, location: 'Fictional County', currentVersionId: version.id, etag: 'course-updated' };
        courses = current ? courses.map((course) => course.id === entry.id ? entry : course) : [...courses, entry];
        return Promise.resolve(version);
      },
      createPlayer: (displayName, id, _signal, initial) => {
        const existing = players.find((player) => player.id === id);
        if (existing) return Promise.resolve(existing);
        const observation = initial ? { ...initial, id, recordedAt: '2026-01-02T00:00:00Z', recordedBy: actor, previousObservationId: null } : null;
        const player: PlayerProfile = { id, displayName, currentIndex: observation, etag: 'player-created', createdAt: '2026-01-02T00:00:00Z' };
        players = [...players, player]; histories.set(id, observation ? [observation] : []);
        return Promise.resolve(player);
      },
      renamePlayer: (player, displayName) => {
        const current = players.find((entry) => entry.id === player.id);
        if (current?.etag !== player.etag) return Promise.reject(new Error('Fictional player revision changed'));
        const updated = { ...current, displayName, etag: 'player-renamed' };
        players = players.map((entry) => entry.id === updated.id ? updated : entry);
        return Promise.resolve(updated);
      },
      history: (id) => Promise.resolve({ observations: histories.get(id) ?? [] }),
      recordIndex: (player, input, id) => {
        const current = players.find((entry) => entry.id === player.id);
        if (current?.etag !== player.etag) return Promise.reject(new Error('Fictional player revision changed'));
        const observation = { ...input, id, recordedAt: '2026-01-03T00:00:00Z', recordedBy: actor,
          previousObservationId: histories.get(player.id)?.find((entry) => entry.effectiveDate === input.effectiveDate)?.id ?? null };
        const updated = { ...current, etag: 'player-index-updated', currentIndex: observation };
        players = players.map((entry) => entry.id === updated.id ? updated : entry);
        histories.set(player.id, [observation, ...(histories.get(player.id) ?? [])]);
        return Promise.resolve(updated);
      },
    };
}

export function Fixture() {
  const [tab, setTab] = useState('courses');
  const client = useMemo(() => createFictionalCatalog(), []);
  return <div className="app"><main><p>Fictional catalog browser fixture · no server writes</p>
    <nav className="event-actions" aria-label="Fictional catalogs"><button onClick={() => { setTab('courses'); }}>Fictional Courses</button>
      <button onClick={() => { setTab('players'); }}>Fictional Players</button></nav>
    {tab === 'courses' ? <CoursesCatalog client={client} /> : <PlayersCatalog client={client} />}
  </main></div>;
}
const element = document.getElementById('catalog-workspace-fixture');
if (!element) throw new Error('Missing fictional catalog fixture root');
createRoot(element).render(<Fixture />);
