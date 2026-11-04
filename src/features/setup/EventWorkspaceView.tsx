import { useCallback, useEffect, useRef, useState } from 'react';
import type { CatalogClient } from '../../client/catalog';
import { EventChangedError } from '../../client/events';
import type { SetupClient } from '../../client/setup';
import { isEventSetupInput } from '../../contracts/setup';
import type { CourseCatalogEntry, CourseVersion, IndexObservation, PlayerProfile, TeeProfile } from '../../domain/catalog';
import type { EventSetupInput, EventWorkspace, RoundSetupInput, RoundSnapshot } from '../../domain/setup';
import './setup.css';

function inputFrom(workspace: EventWorkspace): EventSetupInput {
  return {
    name: workspace.event.name, location: workspace.location,
    playerIds: workspace.roster.map((player) => player.playerId),
    rounds: workspace.rounds.map(roundInput),
  };
}
function roundInput(round: RoundSnapshot): RoundSetupInput {
  return { id: round.id, name: round.name, courseId: round.courseId, courseVersionId: round.courseVersionId,
    teeProfileId: round.teeProfile.id, groups: round.groups };
}

async function readSetupCatalog(catalog: CatalogClient, signal: AbortSignal) {
  const courses: CourseCatalogEntry[] = [];
  const players: PlayerProfile[] = [];
  const courseCursors = new Set<string>();
  const playerCursors = new Set<string>();
  let cursor: string | undefined;
  do {
    const page = await catalog.courses(signal, cursor);
    signal.throwIfAborted();
    courses.push(...page.courses); cursor = page.continuationToken;
    if (cursor && courseCursors.has(cursor)) throw new Error('Invalid course paging response.');
    if (cursor) courseCursors.add(cursor);
  } while (cursor);
  do {
    const page = await catalog.players(signal, cursor);
    signal.throwIfAborted();
    players.push(...page.players); cursor = page.continuationToken;
    if (cursor && playerCursors.has(cursor)) throw new Error('Invalid player paging response.');
    if (cursor) playerCursors.add(cursor);
  } while (cursor);
  return { courses, players };
}

export function EventWorkspaceView({ eventId, canManageCatalog, setup, catalog }: {
  readonly eventId: string;
  readonly canManageCatalog: boolean;
  readonly setup: SetupClient;
  readonly catalog: CatalogClient;
}) {
  const [workspace, setWorkspace] = useState<EventWorkspace | null>(null);
  const [draft, setDraft] = useState<EventSetupInput | null>(null);
  const [courses, setCourses] = useState<readonly CourseCatalogEntry[] | null>(null);
  const [players, setPlayers] = useState<readonly PlayerProfile[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const [catalogError, setCatalogError] = useState('');
  const [settledWorkspace, setSettledWorkspace] = useState<{ readonly client: SetupClient; readonly eventId: string } | null>(null);
  const initialPending = settledWorkspace?.client !== setup || settledWorkspace.eventId !== eventId;
  const [settledCatalog, setSettledCatalog] = useState<{ readonly client: CatalogClient; readonly attempt: number } | null>(null);
  const [catalogAttempt, setCatalogAttempt] = useState(0);
  const [catalogRefreshing, setCatalogRefreshing] = useState(false);
  const catalogPending = catalogRefreshing || settledCatalog?.client !== catalog || settledCatalog.attempt !== catalogAttempt;
  const [refreshConfirmed, setRefreshConfirmed] = useState<ReadonlySet<string>>(new Set());
  const refreshRequests = useRef(new Map<string, { readonly id: string; readonly etag: string }>());
  const [versionPending, setVersionPending] = useState<ReadonlySet<string>>(new Set());
  const active = useRef<AbortController | null>(null);
  const editing = workspace?.event.role === 'owner' && workspace.event.status === 'active' && canManageCatalog;

  useEffect(() => {
    const controller = new AbortController();
    void setup.load(eventId, controller.signal).then((value) => {
      if (!controller.signal.aborted) { setWorkspace(value); setDraft(inputFrom(value)); }
    }).catch((failure: unknown) => {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Could not load event workspace.');
    }).finally(() => {
      if (!controller.signal.aborted) setSettledWorkspace({ client: setup, eventId });
    });
    return () => { controller.abort(); active.current?.abort(); };
  }, [eventId, setup]);

  useEffect(() => {
    if (!editing) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const result = await readSetupCatalog(catalog, controller.signal);
        if (!controller.signal.aborted) { setCourses(result.courses); setPlayers(result.players); setCatalogError(''); setRefreshConfirmed(new Set()); }
      } catch (failure) {
        if (!controller.signal.aborted) setCatalogError(failure instanceof Error ? failure.message : 'Could not load catalog selections.');
      } finally {
        if (!controller.signal.aborted) setSettledCatalog({ client: catalog, attempt: catalogAttempt });
      }
    })();
    return () => { controller.abort(); };
  }, [catalog, catalogAttempt, editing]);

  async function run(work: (signal: AbortSignal) => Promise<void>) {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller; setBusy(true); setNotice('');
    try { await work(controller.signal); }
    catch (failure) {
      if (!controller.signal.aborted) {
        setNotice(failure instanceof Error ? failure.message : 'Save failed. Draft preserved; nothing was confirmed saved.');
        if (failure instanceof EventChangedError) setConflict(true);
      }
    } finally {
      active.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  function changeRound(updated: RoundSetupInput) {
    setDraft((previous) => previous ? { ...previous, rounds: previous.rounds.map((round) => round.id === updated.id ? updated : round) } : previous);
  }
  function preserveDraft(value: EventWorkspace) {
    setDraft((previous) => previous ? { ...previous, rounds: [
      ...previous.rounds, ...value.rounds.filter((round) => !previous.rounds.some((item) => item.id === round.id)).map(roundInput),
    ] } : inputFrom(value));
  }
  const onVersionPending = useCallback((id: string, pending: boolean) => {
    setVersionPending((previous) => {
      const next = new Set(previous);
      if (pending) next.add(id); else next.delete(id);
      return next;
    });
  }, []);

  return <section className="setup-view">
    <a href="#events">Back to events</a>
    <h1>Saved event workspace</h1>
    <button disabled={busy || initialPending || editing && catalogPending || versionPending.size > 0} onClick={() => { void run(async (signal) => {
      const value = await setup.load(eventId, signal);
      signal.throwIfAborted();
      setWorkspace(value); setError(''); setConflict(false); setRefreshConfirmed(new Set());
      preserveDraft(value);
      if (canManageCatalog && value.event.role === 'owner' && value.event.status === 'active') {
        setCatalogRefreshing(true);
        try {
          const result = await readSetupCatalog(catalog, signal);
          signal.throwIfAborted();
          setCourses(result.courses); setPlayers(result.players); setCatalogError('');
        } catch (failure) {
          if (!signal.aborted) {
            setCatalogError(failure instanceof Error ? failure.message : 'Current catalog values are unavailable.');
            setNotice('Workspace refreshed, but current catalog values are unavailable. Your local draft is preserved. Retry catalog selections before changing captured setup inputs.');
          }
          return;
        } finally {
          if (!signal.aborted) setCatalogRefreshing(false);
        }
      }
      setNotice('Workspace refreshed. Your local draft is preserved, including newly saved rounds. Review before saving.');
    }); }}>Refresh workspace</button>
    {error && <p role="alert">{error}</p>}
    {!workspace && !error && <p role="status">Loading workspace...</p>}
    {workspace && <>
      <h2>{workspace.event.name}</h2><p>{workspace.location || 'General location not supplied'}</p>
      {!editing && <p>{workspace.event.status === 'archived' ? 'Archived event: read-only owner workspace.' : 'Read-only event projection. Catalog setup requires both catalog-manager and active event-owner permission.'}</p>}
      <p>Saved roster: {workspace.roster.length ? workspace.roster.map((player) => player.displayName).join(', ') : 'Not configured'}</p>
      {workspace.rounds.length === 0 && <p>No saved rounds.</p>}
      <ol className="round-list">{workspace.rounds.map((round) => <li className="panel" key={round.id}>
        <h3>{round.name} — {round.course.name}</h3>
        <p className="setup-version">Saved course version: {round.courseVersionId}</p>
        <p>Tee: {round.teeProfile.name} / {round.teeProfile.category} / {round.teeProfile.holeCount} holes</p>
        <ul>{round.groups.map((group) => <li key={group.number}>Group {group.number}: {group.playerIds.map((id) => round.players.find((player) => player.playerId === id)?.displayName ?? 'Unavailable').join(', ')}</li>)}</ul>
        {workspace.event.role === 'owner' && <div>
          <ul className="setup-index-list">{round.players.map((player) => {
            const current = players?.find((item) => item.id === player.playerId);
            return <li key={player.playerId}>
              <h4>{player.displayName}</h4>
              <dl className="setup-index-comparison"><div><dt>Captured setup HI</dt><dd>{indexLabel(player.handicapIndex)}</dd></div>
                {editing && <div><dt>Current catalog HI</dt><dd>{catalogPending ? 'Loading current catalog HI...'
                  : catalogError ? 'Unavailable — catalog loading failed.' : current ? indexLabel(current.currentIndex) : 'Unavailable — player not found in current catalog.'}</dd></div>}
              </dl>
              {editing && !catalogPending && !catalogError && current && <p>{current.currentIndex?.id !== player.handicapIndex?.id
                ? 'Changed since capture. The saved input has not been changed automatically.'
                : 'Captured and current observations match.'}</p>}
            </li>;
          })}</ul>
          {editing && <div className="setup-index-refresh">
            <p>Review captured and current values above. Refresh replaces this saved round's captured setup inputs using catalog observations at refresh time and audits the previous values. It preserves saved course, tee and groups. This is not score recalculation; scored-round policy remains unresolved.</p>
            <label className="setup-index-confirm"><input type="checkbox" checked={refreshConfirmed.has(round.id)}
              disabled={busy || initialPending || catalogPending || catalogError !== '' || versionPending.size > 0 || conflict
                || !round.players.every((player) => players?.some((item) => item.id === player.playerId))}
              onChange={(event) => {
                const checked = event.target.checked;
                setRefreshConfirmed((previous) => {
                  const next = new Set(previous);
                  if (checked) next.add(round.id); else next.delete(round.id);
                  return next;
                });
              }} />I confirm replacing captured setup HI for {round.name} with the current catalog observations.</label>
            <button disabled={busy || initialPending || catalogPending || catalogError !== '' || versionPending.size > 0 || conflict || !refreshConfirmed.has(round.id)
              || !round.players.every((player) => players?.some((item) => item.id === player.playerId))}
              onClick={() => { void run(async (signal) => {
                const request = refreshRequests.current.get(round.id) ?? { id: crypto.randomUUID(), etag: workspace.etag };
                refreshRequests.current.set(round.id, request);
                try {
                  const saved = await setup.refreshIndices(eventId, round.id, request.etag, request.id, signal);
                  signal.throwIfAborted();
                  setWorkspace(saved); preserveDraft(saved); setRefreshConfirmed(new Set());
                  refreshRequests.current.delete(round.id);
                  setNotice(`Captured setup HI refreshed for ${round.name}. Saved course, tee and groups were preserved. No scores were recalculated.`);
                } catch (failure) {
                  if (failure instanceof EventChangedError) {
                    refreshRequests.current.delete(round.id); setRefreshConfirmed(new Set());
                  }
                  throw failure;
                }
              }); }}>Refresh captured setup HI for {round.name}</button>
          </div>}
        </div>}
      </li>)}</ol>
    </>}
    {editing && draft && <form className="panel setup-form" onSubmit={(event) => {
      event.preventDefault();
      if (initialPending || catalogPending || catalogError !== '' || conflict || !isEventSetupInput(draft) || versionPending.size > 0) return;
      void run(async (signal) => {
        const saved = await setup.save(eventId, workspace.etag, draft, signal);
        if (!signal.aborted) {
          setWorkspace(saved); setDraft(inputFrom(saved)); setNotice('Event workspace saved. Course and handicap inputs were captured by the server.');
        }
      });
    }}>
      <h2>Configure event setup</h2>
      <p>Choose 4–8 saved players and 1–8 rounds. Explicitly choose a saved course version and tee; assign each player once to groups 1–4, at most four players per group. Existing rounds cannot be deleted. No scores or handicap calculations are performed.</p>
      {catalogError && <div><p role="alert">{catalogError} Your setup draft is preserved.</p>
        <button type="button" disabled={busy || catalogPending} onClick={() => {
          setCatalogAttempt((previous) => previous + 1);
        }}>Retry catalog selections</button>
      </div>}
      {catalogPending && <p role="status">Loading saved catalog selections...</p>}
      <fieldset disabled={busy || initialPending || catalogPending || catalogError !== '' || versionPending.size > 0 || courses === null || players === null}>
        <label>Workspace name<input required maxLength={100} value={draft.name} onChange={(event) => { setDraft({ ...draft, name: event.target.value }); }} /></label>
        <label>General location<input maxLength={200} value={draft.location} onChange={(event) => { setDraft({ ...draft, location: event.target.value }); }} /></label>
        <fieldset><legend>Saved player roster ({draft.playerIds.length}/8)</legend>
          {players?.length === 0 && <p>No saved players. Create players in the manager catalog first.</p>}
          {players?.map((player) => <label className="setup-check" key={player.id}>
            <input type="checkbox" checked={draft.playerIds.includes(player.id)}
              disabled={!draft.playerIds.includes(player.id) && draft.playerIds.length >= 8}
              onChange={(event) => {
                const ids = event.target.checked ? [...draft.playerIds, player.id] : draft.playerIds.filter((id) => id !== player.id);
                setDraft({ ...draft, playerIds: ids, rounds: draft.rounds.map((round) => ({
                  ...round, groups: round.groups.map((group) => ({ ...group, playerIds: group.playerIds.filter((id) => ids.includes(id)) })).filter((group) => group.playerIds.length > 0),
                })) });
              }} />{player.displayName} — HI {player.currentIndex?.value ?? 'Unknown'}
          </label>)}
          {draft.playerIds.filter((id) => !players?.some((player) => player.id === id)).map((id) => <p key={id}>Saved roster player unavailable in catalog: {workspace.roster.find((player) => player.playerId === id)?.displayName ?? id}</p>)}
        </fieldset>
        {draft.rounds.map((round, index) => <RoundEditor key={round.id} round={round} number={index + 1}
          saved={workspace.rounds.find((item) => item.id === round.id)} courses={courses ?? []}
          players={(players ?? []).filter((player) => draft.playerIds.includes(player.id))}
          rosterIds={draft.playerIds} client={catalog} onChange={changeRound} onPending={onVersionPending} />)}
        <button type="button" disabled={draft.rounds.length >= 8} onClick={() => {
          setDraft({ ...draft, rounds: [...draft.rounds, { id: crypto.randomUUID(), name: '', courseId: '', courseVersionId: '', teeProfileId: 0, groups: [] }] });
        }}>Add Round</button>
      </fieldset>
      {!isEventSetupInput(draft) && <p>Setup is incomplete: require 4–8 players, 1–8 named rounds, explicit course versions/tees and complete valid group assignments.</p>}
      <button disabled={busy || conflict || initialPending || catalogPending || catalogError !== '' || versionPending.size > 0 || courses === null || players === null || !isEventSetupInput(draft)}>Save event workspace</button>
    </form>}
    <p role={conflict ? 'alert' : 'status'}>{busy ? 'Working...' : notice}</p>
    <p>Catalog edits do not automatically change captured handicap inputs in saved rounds. Current catalog values are the latest loaded observations; Refresh workspace fetches updates. An eligible owner must explicitly confirm a setup-input refresh to change saved captures. Invitations, score entry, scoring, randomization and synchronization are not included.</p>
  </section>;
}

function indexLabel(observation: IndexObservation | null | undefined): string {
  return observation ? `${observation.value} — effective ${observation.effectiveDate}; ${observation.source}` : 'Unknown — no handicap observation';
}

function RoundEditor({ round, number, saved, courses, players, rosterIds, client, onChange, onPending }: {
  readonly round: RoundSetupInput;
  readonly number: number;
  readonly saved: RoundSnapshot | undefined;
  readonly courses: readonly CourseCatalogEntry[];
  readonly players: readonly PlayerProfile[];
  readonly rosterIds: readonly string[];
  readonly client: CatalogClient;
  readonly onChange: (round: RoundSetupInput) => void;
  readonly onPending: (id: string, pending: boolean) => void;
}) {
  const [loaded, setLoaded] = useState<CourseVersion | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const current = courses.find((course) => course.id === round.courseId);
  const savedMatches = saved?.courseId === round.courseId && saved.courseVersionId === round.courseVersionId;
  const versionId = round.courseVersionId;
  useEffect(() => {
    if (!versionId) return;
    const controller = new AbortController();
    onPending(round.id, true);
    void client.version(round.courseId, versionId, controller.signal).then((value) => {
      if (!controller.signal.aborted) { setLoaded(value); setError(''); }
    }).catch((failure: unknown) => {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Could not load the selected version.');
    }).finally(() => { if (!controller.signal.aborted) onPending(round.id, false); });
    return () => { controller.abort(); onPending(round.id, false); };
  }, [attempt, client, onPending, round.courseId, round.id, versionId]);
  const profiles: readonly TeeProfile[] = loaded?.id === versionId && loaded.courseId === round.courseId ? loaded.data.teeProfiles
    : savedMatches ? [saved.teeProfile] : [];
  return <fieldset className="setup-round">
    <legend>Round {number}{saved ? ' (saved; retained)' : ''}</legend>
    <label>Round {number} name<input required maxLength={100} value={round.name} onChange={(event) => { onChange({ ...round, name: event.target.value }); }} /></label>
    <label>Round {number} course<select required value={round.courseId} onChange={(event) => {
      onChange({ ...round, courseId: event.target.value, courseVersionId: '', teeProfileId: 0 });
    }}><option value="">Choose a saved course</option>
      {saved && !courses.some((course) => course.id === saved.courseId) && <option value={saved.courseId}>{saved.course.name} (saved course)</option>}
      {courses.map((course) => <option value={course.id} key={course.id}>{course.name} — {course.location}</option>)}
    </select></label>
    <label>Round {number} course version<select required value={versionId} disabled={!round.courseId} onChange={(event) => {
      onChange({ ...round, courseVersionId: event.target.value, teeProfileId: 0 });
    }}><option value="">Choose an explicit version</option>
      {saved?.courseId === round.courseId && saved.courseVersionId !== current?.currentVersionId && <option value={saved.courseVersionId}>Saved version {saved.courseVersionId}</option>}
      {current && <option value={current.currentVersionId}>Current published version {current.currentVersionId}</option>}
    </select></label>
    <label>Round {number} tee profile<select required value={round.teeProfileId || ''} disabled={profiles.length === 0} onChange={(event) => {
      onChange({ ...round, teeProfileId: Number(event.target.value) });
    }}><option value="">Choose a tee and category</option>{profiles.map((profile) => <option key={profile.id} value={profile.id}>
      {profile.name} / {profile.category} / {profile.holeCount} holes / profile {profile.id}
    </option>)}</select></label>
    {error && <div><p role="alert">{error} No new tee was selected.</p>
      <button type="button" onClick={() => { setAttempt((previous) => previous + 1); }}>Retry round {number} version</button>
    </div>}
    {rosterIds.map((id) => <label key={id}>{players.find((player) => player.id === id)?.displayName ?? 'Saved player'} — round {number} group
      <select required value={round.groups.find((group) => group.playerIds.includes(id))?.number ?? ''} onChange={(event) => {
        const number = Number(event.target.value);
        const groups = round.groups.map((group) => ({ ...group, playerIds: group.playerIds.filter((playerId) => playerId !== id) })).filter((group) => group.playerIds.length > 0);
        if (number) {
          const existing = groups.find((group) => group.number === number);
          if (existing) onChange({ ...round, groups: groups.map((group) => group.number === number ? { ...group, playerIds: [...group.playerIds, id] } : group) });
          else onChange({ ...round, groups: [...groups, { number, playerIds: [id] }] });
        } else onChange({ ...round, groups });
      }}><option value="">Assign manually</option>{[1, 2, 3, 4].map((number) => <option key={number} value={number}>Group {number}</option>)}</select>
    </label>)}
  </fieldset>;
}
