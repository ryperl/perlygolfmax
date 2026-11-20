import { useEffect, useRef, useState } from 'react';
import type { QuickCourseVersion } from '../../domain/quick-round';
import type { QuickRoundClient } from '../../client/quick-round';
import type { EventSetupInput, EventWorkspace } from '../../domain/setup';
import type { RoundScores } from '../../domain/scoring';
import type { ScoresClient } from '../../client/scoring';
import type { DotPresetStore } from '../../client/dot-presets';
import { EventChangedError } from '../../client/events';
import { RoundGamesPanel, canManageRoundGames } from '../games';
import { inputFrom, sameSetupInput, setupProblems } from '../setup';
import { RoundAccent } from '../round-theme';
import { QuickSetupFields } from './QuickSetupFields';
import { useQuickDirectory } from './use-quick-directory';
import './quick-round.css';
import { QuickRoundArchive } from './QuickRoundArchive';

interface SaveAttempt {
  readonly input: EventSetupInput;
  readonly etag?: string;
  readonly requestId: string;
  readonly next: 'games' | 'scores';
}

function failureMessage(failure: unknown): string {
  return failure instanceof Error ? failure.message : 'Request failed. Your draft is retained; try again when connected.';
}

function requireQuick(workspace: EventWorkspace, eventId: string): EventWorkspace {
  if (workspace.quickRound !== true || workspace.event.id !== eventId || workspace.event.status !== 'active'
    || workspace.rounds.length !== 1) throw new Error('This is not an editable public Quick round.');
  return workspace;
}

function requireQuickScores(round: RoundScores, eventId: string, roundId: string): RoundScores {
  if (round.eventId !== eventId || round.roundId !== roundId || round.eventStatus !== 'active'
    || !canManageRoundGames(round) || round.permissions?.role !== 'public' || round.quickRound !== true) {
    throw new Error('Public Quick round games are unavailable from this API.');
  }
  return round;
}

export function QuickRoundView({ client, scores, eventId: existingId, presetStore }: {
  readonly client: QuickRoundClient;
  readonly scores: ScoresClient;
  readonly eventId?: string | undefined;
  readonly presetStore?: DotPresetStore | undefined;
}) {
  const [eventId] = useState(() => existingId ?? crypto.randomUUID());
  const [draft, setDraft] = useState<EventSetupInput>(() => ({
    name: '', location: '', playerIds: [], allowPerGolferTees: false,
    rounds: [{ id: crypto.randomUUID(), name: '', courseId: '', courseVersionId: '', teeProfileId: 0, groups: [] }],
  }));
  const [workspace, setWorkspace] = useState<EventWorkspace>();
  const [loading, setLoading] = useState(Boolean(existingId));
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [loadError, setLoadError] = useState('');
  const [message, setMessage] = useState('');
  const [working, setWorking] = useState(false);
  const [attempt, setAttempt] = useState<SaveAttempt>();
  const [review, setReview] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [setupRefreshError, setSetupRefreshError] = useState('');
  const [full, setFull] = useState(false);
  const [gamesOpen, setGamesOpen] = useState(false);
  const [nextAction, setNextAction] = useState<'games' | 'scores'>();
  const [gameDirty, setGameDirty] = useState(false);
  const [scoreAttempt, setScoreAttempt] = useState(0);
  const [roundResult, setRoundResult] = useState<{ readonly workspace: EventWorkspace; readonly attempt: number; readonly round?: RoundScores; readonly error?: string }>();
  const [versionResult, setVersionResult] = useState<QuickCourseVersion>();
  const [versionError, setVersionError] = useState('');
  const [versionAttempt, setVersionAttempt] = useState(0);
  const inFlight = useRef(false);
  const operations = useRef(new Set<AbortController>());
  const setupRegion = useRef<HTMLDivElement>(null);
  const gamesRegion = useRef<HTMLDivElement>(null);
  const previousMode = useRef(false);
  const courses = useQuickDirectory(client.courses);
  const players = useQuickDirectory(client.players);
  const round = draft.rounds[0];
  const version = versionResult?.courseId === round?.courseId && versionResult?.id === round?.courseVersionId ? versionResult : undefined;
  const savedRound = workspace?.rounds[0];
  const scoreRound = roundResult?.workspace === workspace ? roundResult?.round : undefined;
  const scoreError = roundResult?.workspace === workspace ? roundResult?.error : undefined;
  const savedGames = scoreRound?.games?.configuration.games.length ?? 0;
  const locked = savedRound?.scoringStarted === true || scoreRound?.setupLocked === true;
  const captureGap = scoreRound?.setupLocked === true && savedRound?.scoringStarted !== true && scoreRound.courseHandicaps === undefined;
  const changed = !workspace || !sameSetupInput(draft, inputFrom(workspace));
  const problems = setupProblems(draft);
  const directoriesReady = Boolean(courses.items && players.items);
  const setupBlocked = loading || working || gameDirty || Boolean(attempt) || conflict || Boolean(nextAction);
  const canStart = Boolean(workspace && !changed && !attempt && !conflict && !captureGap && !setupRefreshError && !gameDirty && !working && !loading && scoreRound);
  const canSave = !loading && !working && !gameDirty && !conflict && !captureGap && !setupRefreshError && !nextAction
    && Boolean(attempt || changed && version && directoriesReady && problems.length === 0);
  useEffect(() => {
    if (previousMode.current === gamesOpen) return;
    previousMode.current = gamesOpen;
    (gamesOpen ? gamesRegion : setupRegion).current?.focus();
  }, [gamesOpen]);
  useEffect(() => {
    if (!nextAction || !canStart || !savedRound) return;
    setNextAction(undefined);
    if (nextAction === 'games') {
      setGameDirty(true);
      setGamesOpen(true);
    } else window.location.hash = `#events?event=${eventId}&round=${savedRound.id}`;
  }, [nextAction, canStart, savedRound, eventId]);
  useEffect(() => {
    const active = operations.current;
    return () => { for (const controller of active) controller.abort(); };
  }, []);
  useEffect(() => {
    if (!existingId) return;
    const controller = new AbortController();
    setLoading(true);
    setLoadError('');
    void client.load(existingId, controller.signal).then((value) => {
      if (controller.signal.aborted) return;
      const saved = requireQuick(value, existingId);
      setWorkspace(saved);
      setDraft(inputFrom(saved));
    }).catch((failure: unknown) => { if (!controller.signal.aborted) setLoadError(failureMessage(failure)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => { controller.abort(); };
  }, [client, existingId, loadAttempt]);
  useEffect(() => {
    if (!round?.courseId || !round.courseVersionId) return;
    const controller = new AbortController();
    setVersionError('');
    void client.version(round.courseId, round.courseVersionId, controller.signal).then((value) => {
      if (!controller.signal.aborted) {
        if (value.courseId !== round.courseId || value.id !== round.courseVersionId) throw new Error('The selected course version was not confirmed.');
        setVersionResult(value);
      }
    }).catch((failure: unknown) => { if (!controller.signal.aborted) setVersionError(failureMessage(failure)); });
    return () => { controller.abort(); };
  }, [client, round?.courseId, round?.courseVersionId, versionAttempt]);
  useEffect(() => {
    if (!workspace || !savedRound) return;
    if (roundResult?.workspace === workspace && roundResult.attempt === scoreAttempt) return;
    const controller = new AbortController();
    let loaded: RoundScores | undefined;
    void scores.load(eventId, savedRound.id, controller.signal).then(async (value) => {
      controller.signal.throwIfAborted();
      loaded = requireQuickScores(value, eventId, savedRound.id);
      let coherent = workspace;
      if (loaded.setupLocked && savedRound.scoringStarted !== true && loaded.courseHandicaps === undefined) {
        coherent = requireQuick(await client.load(eventId, controller.signal), eventId);
        controller.signal.throwIfAborted();
        if (coherent.rounds[0]?.id !== savedRound.id || coherent.rounds[0].scoringStarted !== true) {
          throw new Error('Captured setup is not yet confirmed. Refresh before reviewing locked inputs.');
        }
        if (!sameSetupInput(inputFrom(workspace), inputFrom(coherent))) {
          setConflict(true);
          setMessage('Scoring locked newer setup inputs. Your draft is retained. Refresh and review before continuing.');
        }
        setWorkspace(coherent);
      }
      setRoundResult({ workspace: coherent, attempt: scoreAttempt, round: loaded });
    }).catch((failure: unknown) => {
      if (!controller.signal.aborted) setRoundResult({ workspace, attempt: scoreAttempt,
        ...(loaded ? { round: loaded } : {}), error: failureMessage(failure) });
    });
    return () => { controller.abort(); };
  }, [client, scores, workspace, savedRound, eventId, scoreAttempt, roundResult]);

  function operation() {
    const controller = new AbortController();
    operations.current.add(controller);
    return controller;
  }
  async function save(next: 'games' | 'scores') {
    if (inFlight.current || gameDirty || loading || conflict || captureGap || setupRefreshError || !round || (!attempt && (problems.length || !version || !directoriesReady))) return;
    const pending = attempt ?? { input: draft, ...(workspace ? { etag: workspace.etag } : {}), requestId: crypto.randomUUID(), next };
    setAttempt(pending);
    setMessage('');
    inFlight.current = true;
    setWorking(true);
    const controller = operation();
    try {
      const value = requireQuick(pending.etag
        ? await client.save(eventId, pending.etag, pending.requestId, pending.input, controller.signal)
        : await client.create(eventId, pending.input, controller.signal), eventId);
      if (controller.signal.aborted) return;
      setWorkspace(value);
      setSetupRefreshError('');
      if (!sameSetupInput(pending.input, inputFrom(value))) {
        setConflict(true);
        setMessage('The round exists, but the latest setup differs. Your draft is retained. Refresh and review before continuing.');
        return;
      }
      setDraft(inputFrom(value));
      setAttempt(undefined);
      setConflict(false);
      setReview(false);
      setGamesOpen(false);
      setNextAction(pending.next);
      setMessage('Round setup saved.');
      window.history.replaceState(null, '', `#events?event=${eventId}&quick=1`);
    } catch (failure) {
      if (!controller.signal.aborted) {
        if (failure instanceof EventChangedError) setConflict(true);
        setMessage(`${failureMessage(failure)} Save is not confirmed. Your draft and retry identity are retained.`);
      }
    } finally {
      operations.current.delete(controller);
      inFlight.current = false;
      if (!controller.signal.aborted) setWorking(false);
    }
  }
  function proceed(next: 'games' | 'scores') {
    if (inFlight.current || nextAction || gameDirty) return;
    if (canSave && (!attempt || attempt.next === next)) { void save(next); return; }
    if (!canStart || !savedRound) return;
    if (next === 'games') {
      setGameDirty(true);
      setGamesOpen(true);
    } else window.location.hash = `#events?event=${eventId}&round=${savedRound.id}`;
  }
  async function refresh() {
    if (inFlight.current || gameDirty) return;
    setNextAction(undefined);
    inFlight.current = true;
    setWorking(true);
    const controller = operation();
    try {
      const value = requireQuick(await client.load(eventId, controller.signal), eventId);
      if (controller.signal.aborted) return;
      setWorkspace(value);
      setSetupRefreshError('');
      setReview(true);
      setMessage('Latest setup loaded. Your draft is retained. Review it before starting a new save attempt.');
    } catch (failure) {
      if (!controller.signal.aborted) setMessage(`${failureMessage(failure)} Your draft and previous save attempt are retained.`);
    } finally {
      operations.current.delete(controller);
      inFlight.current = false;
      if (!controller.signal.aborted) setWorking(false);
    }
  }
  return <RoundAccent tone="sage" className="quick-round">
    <header><p className="eyebrow">Quick round</p><h1>{workspace?.event.name ?? 'Play a Quick round'}</h1>
      <p>Public round · anyone can edit setup and games.</p></header>
    {loading && <p role="status">Loading Quick round…</p>}
    {loadError && <><p role="alert">{loadError}</p><button onClick={() => { setLoadAttempt((value) => value + 1); }}>Retry opening round</button></>}
    {!loading && !loadError && <>
      <div ref={setupRegion} tabIndex={-1} hidden={gamesOpen} className="quick-setup-content">
      <button type="button" aria-expanded={full} onClick={() => { setFull((value) => !value); }}>{full ? 'Compact setup' : 'Open full setup'}</button>
      {(!courses.items || !players.items) && <div>
        {(courses.loading || players.loading) && <p role="status">Loading all saved courses and golfers…</p>}
        {courses.error && <><p role="alert">Courses incomplete: {courses.error}</p><button disabled={courses.loading} onClick={courses.retry}>Retry courses</button>
          <button disabled={courses.loading} onClick={courses.restart}>Restart course directory</button></>}
        {players.error && <><p role="alert">Golfers incomplete: {players.error}</p><button disabled={players.loading} onClick={players.retry}>Retry golfers</button>
          <button disabled={players.loading} onClick={players.restart}>Restart golfer directory</button></>}
      </div>}
      {directoriesReady && !captureGap && <QuickSetupFields draft={draft} courses={courses.items ?? []}
        courseHandicaps={locked ? scoreRound?.courseHandicaps : undefined}
        players={(players.items ?? []).map((player) => {
          if (!locked) return player;
          const captured = savedRound?.players.find((entry) => entry.playerId === player.id);
          return { id: player.id, displayName: player.displayName,
            ...(captured?.handicapIndexValue === undefined ? {} : { handicapIndexValue: captured.handicapIndexValue }) };
        })}
        profiles={version?.data.teeProfiles ?? (savedRound && savedRound.courseId === round?.courseId && savedRound.courseVersionId === round.courseVersionId
          ? [savedRound.teeProfile, ...(savedRound.playerTees ?? []).map((entry) => entry.profile)].filter((profile, index, list) => list.findIndex((entry) => entry.id === profile.id) === index) : [])}
        locked={locked} disabled={setupBlocked} full={full} onChange={(value) => { setDraft(value); setMessage(''); setReview(false); }} />}
      {round?.courseVersionId && !version && !versionError && <p role="status">Loading selected course tees…</p>}
      {versionError && <><p role="alert">{versionError}</p><button disabled={working} onClick={() => { setVersionAttempt((value) => value + 1); }}>Retry course tees</button></>}
      </div>
      {captureGap && !scoreError && <p role="alert">Captured setup needs refresh before reviewing locked inputs. Use Refresh &amp; review setup.</p>}
      {message && <p role={attempt || conflict ? 'alert' : 'status'}>{message}</p>}
      {setupRefreshError && <p role="alert">Game settings saved. Setup refresh required before another setup save or starting scores: {setupRefreshError}</p>}
      {changed && <p role="status">Unsaved setup</p>}
      {changed && directoriesReady && problems.length > 0 && <ul aria-label="Setup needs attention">{problems.map((problem) => <li key={problem}>{problem}</li>)}</ul>}
      {(workspace || attempt) && <div className="quick-actions" hidden={gamesOpen}>
        {(workspace || attempt) && <button type="button" disabled={working || gameDirty} onClick={() => { void refresh(); }}>Refresh & review setup</button>}
        {review && <button type="button" disabled={working || gameDirty} onClick={() => {
          setAttempt(undefined); setConflict(false); setReview(false);
          setMessage('Draft reviewed against the latest setup. Save your changes when ready.');
        }}>Use latest revision for my draft</button>}
        {review && workspace && <button type="button" disabled={working || gameDirty} onClick={() => {
          setDraft(inputFrom(workspace)); setAttempt(undefined); setConflict(false); setReview(false);
          setMessage('Using saved setup. Local setup changes discarded.');
        }}>Discard setup draft and use saved</button>}
      </div>}
      {workspace && <>
        {scoreError && <><p role="alert">{captureGap ? 'Captured setup could not load:' : 'Setup is saved. Games could not load:'} {scoreError}</p>
          <button type="button" disabled={working || gameDirty} onClick={() => { setScoreAttempt((value) => value + 1); }}>Retry loading games</button></>}
        {!scoreRound && !scoreError && <p role="status">Setup saved. Loading games…</p>}
        {scoreRound && gamesOpen && <div ref={gamesRegion} tabIndex={-1} className="quick-games-content" aria-label="Quick round games">
          <RoundGamesPanel round={scoreRound} initialAdd defaultGroupNumber={savedRound?.groups[0]?.number}
            busy={working || changed || Boolean(attempt) || conflict} onDirtyChange={setGameDirty}
            presetStore={presetStore}
            onSave={async (games, etag, requestId) => {
              if (!savedRound || inFlight.current || changed || attempt || conflict) return null;
              inFlight.current = true; setWorking(true);
              const controller = operation();
              try {
                const result = await scores.saveGames(eventId, savedRound.id, games, etag, requestId, controller.signal);
                const acknowledged = requireQuickScores(result.round, eventId, savedRound.id);
                controller.signal.throwIfAborted();
                setRoundResult({ workspace, attempt: scoreAttempt, round: acknowledged });
                try {
                  const latest = requireQuick(await client.load(eventId, controller.signal), eventId);
                  controller.signal.throwIfAborted();
                  setWorkspace(latest);
                  setRoundResult({ workspace: latest, attempt: scoreAttempt, round: acknowledged });
                  setSetupRefreshError('');
                  if (!sameSetupInput(draft, inputFrom(latest))) {
                    setConflict(true);
                    setReview(false);
                    setMessage('Game settings saved, but shared setup changed. Your setup draft is retained. Refresh and review before continuing.');
                  }
                } catch (failure) {
                  if (!controller.signal.aborted) setSetupRefreshError(failureMessage(failure));
                }
                return result;
              } finally {
                operations.current.delete(controller);
                inFlight.current = false;
                if (!controller.signal.aborted) setWorking(false);
              }
            }}
            onRefresh={async () => {
              if (!savedRound || inFlight.current) return null;
              const controller = operation();
              try {
                const value = requireQuickScores(await scores.load(eventId, savedRound.id, controller.signal), eventId, savedRound.id);
                if (!controller.signal.aborted) setRoundResult({ workspace, attempt: scoreAttempt, round: value });
                return value;
              } finally { operations.current.delete(controller); }
            }} />
        </div>}
      </>}
      <section className="quick-next" aria-label="Next steps">
        {savedGames > 0 && <p>{savedGames} saved {savedGames === 1 ? 'game' : 'games'}</p>}
        <div className="quick-next-actions">
          <button type="button" disabled={gamesOpen ? working || gameDirty : Boolean(nextAction) || !canSave && !canStart || Boolean(attempt && attempt.next !== 'games')}
            onClick={() => { if (gamesOpen) setGamesOpen(false); else proceed('games'); }}>
            {gamesOpen ? 'Back to round setup' : attempt?.next === 'games' ? 'Retry Add games' : 'Add games'}
          </button>
          <button type="button" disabled={Boolean(nextAction) || gamesOpen && !canStart || !canSave && !canStart || Boolean(attempt && attempt.next !== 'scores')}
            onClick={() => { proceed('scores'); }}>{attempt?.next === 'scores' ? 'Retry Start scoring' : 'Start scoring'}</button>
        </div>
        {!gamesOpen && changed && <small>Both actions save the round before continuing.</small>}
      </section>
      {workspace && <QuickRoundArchive client={client} event={workspace.event}
          disabled={working || gameDirty || changed || Boolean(attempt) || conflict || Boolean(setupRefreshError) || Boolean(nextAction)}
          onBusyChange={setWorking}
          onArchived={() => { window.location.hash = '#events?choose=1'; }} onRefresh={() => { void refresh(); }} />}
    </>}
  </RoundAccent>;
}
