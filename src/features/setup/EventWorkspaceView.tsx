import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CatalogClient } from '../../client/catalog';
import { EventChangedError, SessionExpiredError } from '../../client/events';
import { PrivateRequestError } from '../../client/private-request';
import type { ScoresClient } from '../../client/scoring';
import type { SetupClient } from '../../client/setup';
import { isEventSetupInput } from '../../contracts/setup';
import type { CourseCatalogEntry, IndexObservation, PlayerProfile } from '../../domain/catalog';
import type { EventSetupInput, EventWorkspace, RoundSetupInput } from '../../domain/setup';
import { playerTee } from '../../domain/tees';
import { RoundEditor } from './RoundEditor';
import { SetupRoster } from './SetupRoster';
import { OverallCompetitionEditor } from './OverallCompetitionEditor';
import { inputFrom, roundInput, sameIds, sameRoundInput, sameSetupInput, setupProblems } from './setup-draft';
import './setup.css';

interface SupersededSetupEdits {
  readonly roster: EventWorkspace['roster'] | null;
  readonly rounds: readonly RoundSetupInput[];
}
async function readCatalogPage<T>(read: () => Promise<T>, signal: AbortSignal): Promise<T> {
  for (;;) {
    signal.throwIfAborted();
    try { return await read(); }
    catch (failure) {
      if (!(failure instanceof PrivateRequestError) || failure.status !== 429) throw failure;
      signal.throwIfAborted();
      await new Promise<void>((resolve, reject) => {
        const abort = () => {
          clearTimeout(timer);
          signal.removeEventListener('abort', abort);
          reject(signal.reason instanceof Error ? signal.reason : new DOMException('Aborted', 'AbortError'));
        };
        const timer = setTimeout(() => {
          signal.removeEventListener('abort', abort);
          resolve();
        }, Math.max(1, failure.retryAfterSeconds ?? 60) * 1000);
        signal.addEventListener('abort', abort, { once: true });
      });
    }
  }
}
async function readSetupCatalog(catalog: CatalogClient, signal: AbortSignal) {
  const courses: CourseCatalogEntry[] = [];
  const players: PlayerProfile[] = [];
  const courseCursors = new Set<string>();
  const playerCursors = new Set<string>();
  let cursor: string | undefined;
  do {
    const page = await readCatalogPage(() => catalog.courses(signal, cursor), signal);
    signal.throwIfAborted();
    courses.push(...page.courses); cursor = page.continuationToken;
    if (cursor && courseCursors.has(cursor)) throw new Error('Invalid course paging response.');
    if (cursor) courseCursors.add(cursor);
  } while (cursor);
  do {
    const page = await readCatalogPage(() => catalog.players(signal, cursor), signal);
    signal.throwIfAborted();
    players.push(...page.players); cursor = page.continuationToken;
    if (cursor && playerCursors.has(cursor)) throw new Error('Invalid player paging response.');
    if (cursor) playerCursors.add(cursor);
  } while (cursor);
  return { courses, players };
}

export function EventWorkspaceView({ eventId, canManageCatalog, setup, catalog, scores, onSessionExpired }: {
  readonly eventId: string;
  readonly canManageCatalog: boolean;
  readonly setup: SetupClient;
  readonly catalog: CatalogClient;
  readonly scores?: ScoresClient;
  readonly onSessionExpired?: (message: string) => void;
}) {
  const [workspace, setWorkspace] = useState<EventWorkspace | null>(null);
  const [draft, setDraft] = useState<EventSetupInput | null>(null);
  const [supersededEdits, setSupersededEdits] = useState<readonly SupersededSetupEdits[]>([]);
  const [courses, setCourses] = useState<readonly CourseCatalogEntry[] | null>(null);
  const [players, setPlayers] = useState<readonly PlayerProfile[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const [catalogError, setCatalogError] = useState('');
  const workspaceRequest = useMemo(() => ({ setup, eventId }), [setup, eventId]);
  const [settledWorkspace, setSettledWorkspace] = useState<object | null>(null);
  const initialPending = settledWorkspace !== workspaceRequest;
  const [settledCatalog, setSettledCatalog] = useState<{ readonly client: CatalogClient; readonly attempt: number } | null>(null);
  const [catalogAttempt, setCatalogAttempt] = useState(0);
  const [catalogRefreshing, setCatalogRefreshing] = useState(false);
  const catalogPending = catalogRefreshing || settledCatalog?.client !== catalog || settledCatalog.attempt !== catalogAttempt;
  const [refreshConfirmed, setRefreshConfirmed] = useState<ReadonlySet<string>>(new Set());
  const refreshRequests = useRef(new Map<string, { readonly id: string; readonly etag: string }>());
  const [versionPending, setVersionPending] = useState<ReadonlySet<string>>(new Set());
  const [selectedRoundId, setSelectedRoundId] = useState('');
  const active = useRef<AbortController | null>(null);
  const expiryHandler = useRef(onSessionExpired);
  useEffect(() => { expiryHandler.current = onSessionExpired; }, [onSessionExpired]);
  const denyAccess = useCallback((failure: Error, expired: boolean) => {
    active.current?.abort();
    setWorkspace(null); setDraft(null); setCourses(null); setPlayers(null); setSupersededEdits([]); setError(failure.message);
    if (expired) expiryHandler.current?.(failure.message);
  }, []);
  const editing = workspace?.event.role === 'owner' && workspace.event.status === 'active' && canManageCatalog;
  const rosterLocked = workspace?.rounds.some((round) => round.scoringStarted === true) ?? false;
  const personalTeesLocked = workspace?.rounds.some((round) => round.scoringStarted && (round.playerTees?.length ?? 0) > 0) ?? false;
  const roundChoices = editing && draft ? draft.rounds : workspace?.rounds ?? [];
  const selectedRound = roundChoices.find((round) => round.id === selectedRoundId) ?? roundChoices[0];
  const changed = workspace !== null && draft !== null && !sameSetupInput(draft, inputFrom(workspace));
  const problems = draft ? setupProblems(draft) : [];

  useEffect(() => {
    const controller = new AbortController();
    void setup.load(eventId, controller.signal).then((value) => {
      if (!controller.signal.aborted) { setWorkspace(value); setDraft(inputFrom(value)); setError(''); setConflict(false); }
    }).catch((failure: unknown) => {
      if (!controller.signal.aborted) {
        setWorkspace(null); setDraft(null); setCourses(null); setPlayers(null); setSupersededEdits([]);
        setError(failure instanceof Error ? failure.message : 'Could not load event workspace.');
        if (failure instanceof SessionExpiredError || failure instanceof PrivateRequestError && failure.status === 401) expiryHandler.current?.(failure.message);
      }
    }).finally(() => {
      if (!controller.signal.aborted) setSettledWorkspace(workspaceRequest);
    });
    return () => { controller.abort(); active.current?.abort(); };
  }, [eventId, setup, workspaceRequest]);

  useEffect(() => {
    if (!editing) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const result = await readSetupCatalog(catalog, controller.signal);
        if (!controller.signal.aborted) { setCourses(result.courses); setPlayers(result.players); setCatalogError(''); setRefreshConfirmed(new Set()); }
      } catch (failure) {
        if (!controller.signal.aborted) {
          if (failure instanceof SessionExpiredError || failure instanceof PrivateRequestError && [401, 403, 404].includes(failure.status)) {
            denyAccess(failure, failure instanceof SessionExpiredError || failure.status === 401);
          } else setCatalogError(failure instanceof Error ? failure.message : 'Could not load catalog selections.');
        }
      } finally {
        if (!controller.signal.aborted) setSettledCatalog({ client: catalog, attempt: catalogAttempt });
      }
    })();
    return () => { controller.abort(); };
  }, [catalog, catalogAttempt, denyAccess, editing]);

  async function run(work: (signal: AbortSignal) => Promise<void>) {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller; setBusy(true); setNotice('');
    try { await work(controller.signal); }
    catch (failure) {
      if (!controller.signal.aborted) {
        if (failure instanceof SessionExpiredError || failure instanceof PrivateRequestError && [401, 403, 404].includes(failure.status)) {
          denyAccess(failure, failure instanceof SessionExpiredError || failure.status === 401);
          return;
        }
        setNotice(failure instanceof Error ? failure.message : 'Save failed. Draft preserved; nothing was confirmed saved.');
        if (failure instanceof EventChangedError) setConflict(true);
      }
    } finally {
      active.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  function editDraft(value: EventSetupInput) {
    setDraft(value);
    if (!conflict) setNotice('');
  }
  function changeRound(updated: RoundSetupInput) {
    setDraft((previous) => previous ? { ...previous, rounds: previous.rounds.map((round) => round.id === updated.id ? updated : round) } : previous);
    if (!conflict) setNotice('');
  }
  function preserveDraft(value: EventWorkspace) {
    if (!draft) { setDraft(inputFrom(value)); return false; }
    const lockedRounds = new Map<string, RoundSetupInput>(value.rounds.filter((round) => round.scoringStarted).map((round) => [round.id, roundInput(round)]));
    const savedRosterIds = value.roster.map((player) => player.playerId);
    const rosterSuperseded = lockedRounds.size > 0 && !sameIds(draft.playerIds, savedRosterIds);
    const roundsSuperseded = draft.rounds.filter((round) => {
      const saved = lockedRounds.get(round.id);
      return saved !== undefined && !sameRoundInput(round, saved);
    });
    const superseded = rosterSuperseded || roundsSuperseded.length > 0;
    if (superseded) {
      const review: SupersededSetupEdits = {
        roster: rosterSuperseded ? draft.playerIds.map((playerId) => ({
          playerId, displayName: players?.find((player) => player.id === playerId)?.displayName
            ?? workspace?.roster.find((player) => player.playerId === playerId)?.displayName ?? 'Unavailable player',
        })) : null,
        rounds: roundsSuperseded,
      };
      setSupersededEdits((previous) => [...previous, review]);
    }
    setDraft({ ...draft,
      allowPerGolferTees: value.rounds.some((round) => round.scoringStarted && (round.playerTees?.length ?? 0) > 0)
        ? true : draft.allowPerGolferTees ?? false,
      playerIds: lockedRounds.size > 0 ? savedRosterIds : draft.playerIds,
      rounds: [
        ...draft.rounds.map((round) => lockedRounds.get(round.id) ?? round),
        ...value.rounds.filter((round) => !draft.rounds.some((item) => item.id === round.id)).map(roundInput),
      ],
    });
    return superseded;
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
    <h1>Event setup</h1>
    <button disabled={busy || initialPending || editing && catalogPending || versionPending.size > 0} onClick={() => { void run(async (signal) => {
      const value = await setup.load(eventId, signal);
      signal.throwIfAborted();
      setWorkspace(value); setError(''); setConflict(false); setRefreshConfirmed(new Set());
      const superseded = preserveDraft(value);
      const draftNotice = superseded
        ? 'Scoring locked saved setup inputs. Locked form values now match the server; superseded local roster/round edits are retained below for read-only review. Your event name/location and unstarted-round drafts remain editable.'
        : 'Your local draft is preserved, including newly saved rounds. Review before saving.';
      if (canManageCatalog && value.event.role === 'owner' && value.event.status === 'active') {
        setCatalogRefreshing(true);
        try {
          const result = await readSetupCatalog(catalog, signal);
          signal.throwIfAborted();
          setCourses(result.courses); setPlayers(result.players); setCatalogError('');
        } catch (failure) {
          if (!signal.aborted) {
            if (failure instanceof SessionExpiredError || failure instanceof PrivateRequestError && [401, 403, 404].includes(failure.status)) throw failure;
            setCatalogError(failure instanceof Error ? failure.message : 'Current catalog values are unavailable.');
            setNotice(`Workspace refreshed, but current catalog values are unavailable. ${draftNotice} Retry catalog selections before changing captured setup inputs.`);
          }
          return;
        } finally {
          if (!signal.aborted) setCatalogRefreshing(false);
        }
      }
      setNotice(`Workspace refreshed. ${draftNotice}`);
    }); }}>Refresh workspace</button>
    {error && <p role="alert">{error}</p>}
    {(initialPending || !workspace && !error) && <p role="status">Loading workspace...</p>}
    {!initialPending && workspace && <>
      <h2>{workspace.event.name}</h2><p>{workspace.location || 'General location not supplied'}</p>
      <a href={`#overview?event=${eventId}`}>View event overview</a>
      {workspace.event.role === 'owner' && <a href={`#purse?event=${encodeURIComponent(eventId)}`}>
        {workspace.event.status === 'archived' ? 'View purse and winnings' : 'Configure purse and winnings'}
      </a>}
      {workspace.event.role === 'owner' && <a href={`#access?event=${encodeURIComponent(eventId)}`}>Player invitations</a>}
      {editing && draft && <OverallCompetitionEditor workspace={workspace} draft={draft} scores={scores}
        disabled={busy || conflict} onDenied={denyAccess}
        onChange={(overallCompetition) => { editDraft({ ...draft, overallCompetition }); }} />}
      {!editing && <p>{workspace.event.status === 'archived' ? 'Archived event: read-only owner workspace.' : 'Read-only event projection. Catalog setup requires both catalog-manager and active event-owner permission.'}</p>}
      <div className="setup-overview">
        <span>{workspace.roster.length} saved players</span><span>{workspace.rounds.length} saved rounds</span>
        {rosterLocked && <span>Roster locked after scoring</span>}
      </div>
      {workspace.rounds.length === 0 && <p>No saved rounds.</p>}
      {roundChoices.length > 0 && <label className="setup-round-picker">Selected round<select value={selectedRound?.id ?? ''}
        disabled={busy || initialPending} onChange={(event) => { setSelectedRoundId(event.target.value); }}>
        {roundChoices.map((round, index) => {
          const saved = workspace.rounds.find((item) => item.id === round.id);
          const state = saved?.scoringStarted ? 'Locked' : !saved ? 'Not saved'
            : editing && !sameRoundInput(roundInput(saved), draft?.rounds.find((item) => item.id === round.id) ?? roundInput(saved)) ? 'Unsaved changes' : 'Saved';
          return <option key={round.id} value={round.id}>Round {index + 1}: {round.name || 'Unnamed round'} — {state}</option>;
        })}
      </select></label>}
      {workspace.rounds.length > 0 && <details className="panel setup-saved-review" open={!editing}>
        <summary>Saved round inputs and handicap review</summary>
        <p>Saved inputs only. Unsaved selections below are not reflected here.</p>
        {!workspace.rounds.some((round) => round.id === selectedRound?.id) && <p>This new round has no saved inputs yet.</p>}
      <ol className="round-list">{workspace.rounds.map((round) => <li hidden={round.id !== selectedRound?.id} key={round.id}>
        <h3>{round.name} — {round.course.name}</h3>
        {workspace.event.role === 'owner' && <a href={`#events?event=${eventId}&round=${round.id}`}>Open owner scorecards for {round.name}</a>}
        {round.scoringStarted && <p>Scoring started: course, tee, players, groups and captured indices are locked. Clearing scores cannot unlock setup. Event name/location and unstarted new rounds remain editable.</p>}
        <p>Immutable saved course version; catalog edits do not replace these inputs.</p>
        <p>Tee: {round.teeProfile.name} / {round.teeProfile.category} / {round.teeProfile.holeCount} holes</p>
        <ul aria-label={`${round.name} assigned tees`}>{round.players.map((player) => {
          const tee = playerTee(round, player.playerId);
          return <li key={player.playerId}>{player.displayName}: {tee.name} / {tee.category}
            {round.playerTees?.some((entry) => entry.playerId === player.playerId) ? ' · personal tee' : ' · default tee'}</li>;
        })}</ul>
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
          {editing && <fieldset className="setup-index-refresh" disabled={round.scoringStarted === true}>
            <p>Review captured and current values above. Refresh replaces this unstarted saved round's captured setup inputs using catalog observations at refresh time and audits the previous values. It preserves saved course, tee and groups. Scored rounds are locked; this is not score recalculation.</p>
            <label className="setup-index-confirm"><input type="checkbox" checked={refreshConfirmed.has(round.id)}
              disabled={busy || catalogPending || catalogError !== '' || versionPending.size > 0 || conflict
                || !round.players.every((player) => players?.some((item) => item.id === player.playerId))}
              onChange={(event) => {
                const checked = event.target.checked;
                setRefreshConfirmed((previous) => {
                  const next = new Set(previous);
                  if (checked) next.add(round.id); else next.delete(round.id);
                  return next;
                });
              }} />I confirm replacing captured setup HI for {round.name} with the current catalog observations.</label>
            <button disabled={busy || catalogPending || catalogError !== '' || versionPending.size > 0 || conflict || !refreshConfirmed.has(round.id)
              || !round.players.every((player) => players?.some((item) => item.id === player.playerId))}
              onClick={() => { void run(async (signal) => {
                const request = refreshRequests.current.get(round.id) ?? { id: crypto.randomUUID(), etag: workspace.etag };
                refreshRequests.current.set(round.id, request);
                try {
                  const saved = await setup.refreshIndices(eventId, round.id, request.etag, request.id, signal);
                  signal.throwIfAborted();
                  setWorkspace(saved);
                  const superseded = preserveDraft(saved);
                  setRefreshConfirmed(new Set());
                  refreshRequests.current.delete(round.id);
                  setNotice(`Captured setup HI refreshed for ${round.name}. Saved course, tee and groups were preserved. No scores were recalculated.${superseded ? ' Scoring locked other setup inputs; superseded local edits are retained below for read-only review, and locked form values now match the server.' : ''}`);
                } catch (failure) {
                  if (failure instanceof EventChangedError) {
                    refreshRequests.current.delete(round.id); setRefreshConfirmed(new Set());
                  }
                  throw failure;
                }
              }); }}>Refresh captured setup HI for {round.name}</button>
          </fieldset>}
        </div>}
      </li>)}</ol>
      </details>}
    </>}
    {!initialPending && workspace && supersededEdits.length > 0 && <section className="panel" aria-label="Superseded locked setup edits">
      <h2>Read-only review of superseded setup edits</h2>
      <p role="alert">Scoring locked saved setup inputs while you were editing. The editable form now uses the server-authoritative locked roster and rounds. Your prior local edits below were not applied and cannot change locked inputs. Event name/location edits remain available. These review copies live only in this page.</p>
      {supersededEdits.map((review, index) => <div key={index}>
        {review.roster && <div><h3>Prior local roster selection</h3><ul>{review.roster.map((player) => <li key={player.playerId}>{player.displayName}</li>)}</ul></div>}
        {review.rounds.map((round) => <div key={round.id}>
          <h3>Prior local round draft: {round.name || 'Unnamed round'}</h3>
          <p className="setup-version">Course: {courses?.find((course) => course.id === round.courseId)?.name ?? 'Previously selected course'}; personal tee assignments: {round.playerTeeSelections?.length ?? 0}. Review the locked saved tee labels above.</p>
          <ul>{round.groups.map((group) => <li key={group.number}>Prior group {group.number}: {group.playerIds.map((id) =>
            players?.find((player) => player.id === id)?.displayName ?? workspace.roster.find((player) => player.playerId === id)?.displayName ?? 'Unavailable').join(', ')}</li>)}</ul>
        </div>)}
      </div>)}
    </section>}
    {!initialPending && editing && draft && <form className="panel setup-form" onSubmit={(event) => {
      event.preventDefault();
      if (catalogPending || catalogError !== '' || conflict || !isEventSetupInput(draft) || versionPending.size > 0) return;
      void run(async (signal) => {
        const saved = await setup.save(eventId, workspace.etag, draft, signal);
        if (!signal.aborted) {
          setWorkspace(saved); setDraft(inputFrom(saved)); setNotice('Event workspace saved.');
        }
      });
    }}>
      <h2>Configure event setup</h2>
      <p>Set event details, choose players, then configure each round. Changes across all rounds are saved together. Existing rounds cannot be deleted.</p>
      <p className="setup-save-state" data-state={changed ? 'draft' : 'saved'}>{changed ? 'Unsaved changes' : 'Matches saved setup'}. {changed ? 'Save the event setup to apply your selections.' : 'Catalog edits do not replace captured round inputs.'}</p>
      {catalogError && <div><p role="alert">{catalogError} Your setup draft is preserved.</p>
        <button type="button" disabled={busy || catalogPending} onClick={() => {
          setCatalogAttempt((previous) => previous + 1);
        }}>Retry catalog selections</button>
      </div>}
      {catalogPending && <p role="status">Loading saved catalog selections...</p>}
      <fieldset className="setup-fields" disabled={busy || catalogPending || catalogError !== '' || versionPending.size > 0 || courses === null || players === null}>
        <details className="setup-section" open={workspace.rounds.length === 0}><summary>1. Event details</summary>
          <label>Workspace name<input required maxLength={100} value={draft.name} onChange={(event) => { editDraft({ ...draft, name: event.target.value }); }} /></label>
          <label>General location<input maxLength={200} value={draft.location} onChange={(event) => { editDraft({ ...draft, location: event.target.value }); }} /></label>
          <label className="setup-check"><input type="checkbox" checked={draft.allowPerGolferTees ?? false} disabled={personalTeesLocked}
            onChange={(event) => {
              const enabled = event.target.checked;
              editDraft({ ...draft, allowPerGolferTees: enabled,
                rounds: enabled ? draft.rounds : draft.rounds.map((round) => ({ ...round, playerTeeSelections: [] })),
              });
            }} />Allow organizer-assigned personal tees</label>
          <p>{personalTeesLocked ? 'Personal tees cannot be disabled: a scored round has captured personal assignments. Unscored rounds remain editable.'
            : 'When enabled, assign compatible tees to golfers independently in each round. Disabling clears unscored personal selections; every golfer uses the default tee.'}</p>
        </details>
        <details className="setup-section" open={workspace.roster.length === 0}><summary>2. Players ({draft.playerIds.length} selected)</summary>
          <SetupRoster players={players ?? []} selectedIds={draft.playerIds} savedRoster={workspace.roster} locked={rosterLocked}
            onChange={(ids) => {
              editDraft({ ...draft, playerIds: ids, rounds: draft.rounds.map((round) => ({
                  ...round, groups: round.groups.map((group) => ({ ...group, playerIds: group.playerIds.filter((id) => ids.includes(id)) })).filter((group) => group.playerIds.length > 0),
                  playerTeeSelections: (round.playerTeeSelections ?? []).filter((entry) => ids.includes(entry.playerId)),
              })) });
            }} />
        </details>
        <h3>3. Round setup</h3>
        <p>Use Selected round above to switch rounds. Round drafts stay in this page until you save.</p>
        {draft.rounds.map((round, index) => <div key={round.id} hidden={round.id !== selectedRound?.id}><RoundEditor round={round} number={index + 1}
          saved={workspace.rounds.find((item) => item.id === round.id)} courses={courses ?? []}
          players={(players ?? []).filter((player) => draft.playerIds.includes(player.id))}
          rosterIds={draft.playerIds} client={catalog} allowPerGolferTees={draft.allowPerGolferTees ?? false}
          onChange={changeRound} onPending={onVersionPending} onDenied={denyAccess} /></div>)}
        <button type="button" disabled={draft.rounds.length >= 8} onClick={() => {
          const id = crypto.randomUUID();
          editDraft({ ...draft, rounds: [...draft.rounds, { id, name: '', courseId: '', courseVersionId: '', teeProfileId: 0, groups: [] }] });
          setSelectedRoundId(id);
        }}>Add Round</button>
      </fieldset>
      {problems.length > 0 && <aside className="setup-problems" aria-label="Setup needs attention"><h3>Before saving</h3>
        <ul>{problems.map((problem) => <li key={problem}>{problem}</li>)}</ul>
      </aside>}
      <div className="setup-save-bar">
        <p role={conflict ? 'alert' : 'status'}>{busy ? 'Working...' : notice || (changed ? 'Unsaved changes across this event' : 'Selections match saved setup')}</p>
        <button disabled={busy || conflict || catalogPending || catalogError !== '' || versionPending.size > 0 || courses === null || players === null || !isEventSetupInput(draft)}>Save event workspace</button>
      </div>
    </form>}
    {!editing && <p role={conflict ? 'alert' : 'status'}>{busy ? 'Working...' : notice}</p>}
    <p>Catalog edits do not automatically change captured handicap inputs. Review saved round inputs to confirm an eligible unstarted round's index refresh. Stroke scorecards and configured Stableford games are separate. Invitations, randomization and offline synchronization are not included.</p>
  </section>;
}

function indexLabel(observation: IndexObservation | null | undefined): string {
  return observation ? `${observation.value} — effective ${observation.effectiveDate}; ${observation.source}` : 'Unknown — no handicap observation';
}
