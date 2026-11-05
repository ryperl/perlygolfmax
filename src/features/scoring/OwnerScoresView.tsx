import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ScoresClient } from '../../client/scoring';
import { EventChangedError } from '../../client/events';
import type { GameWriteResult, RoundScores } from '../../domain/scoring';
import type { RoundGameDefinition } from '../../domain/games';
import type { ScoreLocation, ScoreView } from '../../domain/score-location';
import { RoundGamesPanel } from '../games';
import { RoundLeaderboard } from '../leaderboard';
import { sameHoleScore, scorePermissions } from '../../domain/scoring';
import { scoreAccessKey, writablePlayerIds } from './score-access';
import { scorecardHoles, scorecardTee } from '../../domain/tees';
import { useOwnerScores } from './useOwnerScores';
import { GroupHoleEntry } from './GroupHoleEntry';
import { SavedScorecards } from './SavedScorecards';
import { cardFor, conflictedDraft, editedDraft, entryKey, entryScore, savedHole } from './entry-state';
import type { HoleDraft } from './entry-state';
import { planGroup, saveGroupEntries } from './save-group';
import './scoring.css';

export interface OwnerScoresViewProps {
  readonly client: ScoresClient;
  readonly eventId: string;
  readonly roundId: string;
  readonly onSessionExpired: (message: string) => void;
  readonly overviewHref?: string | null;
  readonly initialLocation?: ScoreLocation | undefined;
  readonly onLocationChange?: ((location: ScoreLocation) => void) | undefined;
}

export function OwnerScoresView(props: OwnerScoresViewProps) {
  const [identity, setIdentity] = useState({ client: props.client, generation: 0 });
  if (identity.client !== props.client) setIdentity({ client: props.client, generation: identity.generation + 1 });
  return <OwnerScoresController key={`${props.eventId}:${props.roundId}:${String(identity.generation)}`} {...props} />;
}

function OwnerScoresController({ client, eventId, roundId, onSessionExpired, overviewHref, initialLocation, onLocationChange }: OwnerScoresViewProps) {
  const [drafts, setDrafts] = useState<ReadonlyMap<string, HoleDraft>>(new Map());
  const currentDrafts = useRef(drafts);
  const draftAccess = useRef<string | null>(null);
  const hadRound = useRef(false);
  const [groupNumber, setGroupNumber] = useState<number | null>(() => initialLocation?.groupNumber ?? null);
  const [holeNumber, setHoleNumber] = useState<number | null>(() => initialLocation?.holeNumber ?? null);
  const [screen, setScreen] = useState<ScoreView>(() => initialLocation?.view ?? 'cards');
  const [focusHole, setFocusHole] = useState<number | null>(null);
  const locationHandler = useRef(onLocationChange);
  useLayoutEffect(() => { locationHandler.current = onLocationChange; }, [onLocationChange]);
  const [gamesDirty, setGamesDirty] = useState(false);
  const [notice, setNotice] = useState('');
  const [refreshVersion, setRefreshVersion] = useState(0);
  const saving = useRef(false);
  const alive = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const { round, busy, error, stale, run, refresh, accept, pauseForEdit, currentRound } = useOwnerScores(
    client, eventId, roundId, drafts.size > 0 || gamesDirty, onSessionExpired,
  );
  const gameDirtyChanged = useCallback((dirty: boolean) => {
    if (dirty) pauseForEdit();
    setGamesDirty(dirty);
  }, [pauseForEdit]);
  const permissions = round && scorePermissions(round);
  const writeIds = round ? writablePlayerIds(round) : [];
  const assignedGroup = round?.groups.find((item) => item.playerIds.includes(permissions?.viewerPlayerId ?? ''));
  const group = groupNumber === null ? assignedGroup ?? round?.groups[0] : round?.groups.find((item) => item.number === groupNumber);
  const accessChanged = round !== null && drafts.size > 0 && draftAccess.current !== scoreAccessKey(round);
  const hole = holeNumber === null ? round?.layout[0] : round?.layout.find((item) => item.number === holeNumber);
  const canEditGroup = !!group && !!hole && group.playerIds.length > 0 && group.playerIds.every((id) => writeIds.includes(id)) && !accessChanged;
  const resolvedGroup = group?.number;
  const resolvedHole = hole?.number;
  useLayoutEffect(() => {
    if (resolvedGroup !== undefined && resolvedHole !== undefined) {
      // Capture defaults once so a later server layout change cannot silently move entry.
      setGroupNumber(resolvedGroup);
      setHoleNumber(resolvedHole);
      locationHandler.current?.({ groupNumber: resolvedGroup, holeNumber: resolvedHole, view: screen });
    }
  }, [resolvedGroup, resolvedHole, screen]);
  useEffect(() => {
    if (round && currentDrafts.current.size > 0 && draftAccess.current !== scoreAccessKey(round)) draftAccess.current = null;
    if (round) { hadRound.current = true; return; }
    if (!hadRound.current) return;
    currentDrafts.current = new Map();
    draftAccess.current = null;
    setDrafts(new Map());
    setGamesDirty(false);
    setNotice('');
  }, [round]);

  function update(key: string, draft: HoleDraft | null) {
    const next = new Map(currentDrafts.current);
    if (draft) next.set(key, draft); else next.delete(key);
    currentDrafts.current = next;
    setDrafts(next);
  }
  function edit(playerId: string, text: string) {
    if (!round || !hole || busy || saving.current || !canEditGroup || !writeIds.includes(playerId)) return;
    if (currentDrafts.current.size === 0) draftAccess.current = scoreAccessKey(round);
    pauseForEdit();
    const key = entryKey(playerId, hole.number);
    update(key, editedDraft(text, cardFor(round, playerId), currentDrafts.current.get(key)));
    setNotice('');
  }
  function review(playerId: string) {
    if (!round || !hole || busy || !canEditGroup || !writeIds.includes(playerId)) return;
    const key = entryKey(playerId, hole.number);
    const local = currentDrafts.current.get(key);
    if (!local || local.status !== 'conflict' || local.conflictAt === undefined || refreshVersion <= local.conflictAt) return;
    update(key, { text: local.text, baseEtag: cardFor(round, playerId).etag, status: 'draft', mustWrite: true });
    setNotice('Reviewed against the refreshed saved card. Your value is a new unsaved intent; save the group to apply it.');
  }
  async function refreshSavedRound(): Promise<RoundScores | null> {
    const value = await refresh();
    if (!value) return null;
    for (const [key, local] of currentDrafts.current) {
      const playerId = key.slice(0, key.lastIndexOf(':'));
      const score = entryScore(local.text);
      const card = cardFor(value, playerId);
      if (score && local.status !== 'conflict' && !local.attempt?.sent && card.etag !== local.baseEtag) {
        update(key, conflictedDraft(score, card, refreshVersion, local));
      }
    }
    setRefreshVersion((previous) => previous + 1);
    setNotice('Saved round refreshed. Local values are preserved; compare saved vs intended before reviewing a conflict.');
    return value;
  }
  async function saveGameSettings(games: readonly RoundGameDefinition[], etag: string | null, requestId: string): Promise<GameWriteResult | null> {
    if (!round || round.eventStatus !== 'active' || scorePermissions(round).role !== 'owner' || !scorePermissions(round).canManageGames) throw new EventChangedError('This round is read-only. Refresh before changing games.');
    return run(async (signal) => {
      const current = currentRound();
      if (!current || current.eventStatus !== 'active' || scorePermissions(current).role !== 'owner'
        || !scorePermissions(current).canManageGames) throw new EventChangedError('Game permissions changed. Refresh before changing games.');
      const result = await client.saveGames(eventId, roundId, games, etag, requestId, signal);
      signal.throwIfAborted();
      accept(result.round);
      return result;
    });
  }
  async function save(advance: boolean) {
    if (!round || !group || !hole || busy || saving.current || !canEditGroup) return;
    const plan = planGroup(round, group.playerIds, hole.number, currentDrafts.current);
    if (plan.invalid.length > 0) {
      setNotice('Nothing sent. Check every intended entry: use a positive number, X / X7, DNF, or blank for unplayed.');
      return;
    }
    if (plan.conflicts.length > 0) {
      for (const playerId of plan.conflicts) {
        const key = entryKey(playerId, hole.number);
        const local = currentDrafts.current.get(key);
        const score = local && entryScore(local.text);
        if (local && score && local.status !== 'conflict') update(key, conflictedDraft(score, cardFor(round, playerId), refreshVersion, local));
      }
      setNotice('Nothing sent. Refresh saved round and review each conflict before saving this group.');
      return;
    }
    for (const key of plan.unchanged) update(key, null);
    const currentHole = hole.number;
    const index = round.layout.findIndex((item) => item.number === currentHole);
    const next = round.layout[index + 1];
    const unplayed = [...plan.targets.values()].filter((score) => score.kind === 'unplayed').length;
    function complete(writes: number) {
      const movement = advance ? next ? ` Viewing hole ${String(next.number)}.` : ' Scorecards opened for review; the round is not finalized.' : ' Stayed on this hole.';
      setNotice(`${writes === 0 ? 'No changes sent' : `Saved — ${String(writes)} player changes acknowledged`}; ${String(unplayed)} unplayed.${movement}`);
      if (advance && next) { setHoleNumber(next.number); setFocusHole(next.number); }
      if (advance && !next) setScreen('cards');
    }
    if (plan.writes.length === 0) { complete(0); return; }
    saving.current = true;
    setNotice('Saving one player at a time…');
    let latest: RoundScores = round;
    let operationSignal: AbortSignal | undefined;
    try {
      const result = await run(async (signal) => {
        operationSignal = signal;
        const current = currentRound();
        if (!current || scoreAccessKey(current) !== scoreAccessKey(round)) {
          throw new EventChangedError('Score permissions or playing groups changed. Refresh and review before saving.');
        }
        return saveGroupEntries({
          client, round, holeNumber: currentHole, plan, signal, refreshVersion, onDraft: update,
          onProjection: (value) => { latest = value; accept(value); },
        });
      });
      if (result && alive.current) complete(plan.writes.length);
      else if (alive.current) setNotice('No new requests sent. Wait for the active operation or service retry delay, then retry; entries are kept on this page.');
    } catch {
      if (!alive.current || operationSignal?.aborted) return;
      const confirmed = [...plan.targets].filter(([playerId, score]) =>
        !currentDrafts.current.has(entryKey(playerId, currentHole))
          && sameHoleScore(savedHole(cardFor(latest, playerId), currentHole), score)
          && (score.kind !== 'unplayed' || plan.writes.some((write) => write.playerId === playerId))).length;
      const remaining = group.playerIds.filter((playerId) => currentDrafts.current.has(entryKey(playerId, currentHole))).length;
      setNotice(`${String(confirmed)} saved / ${String(remaining)} remaining not confirmed or need review. Stayed on hole ${String(currentHole)}. Retry only the remaining values; acknowledged changes are not sent again.`);
    } finally {
      saving.current = false;
    }
  }
  if (round?.eventStatus === 'archived' && permissions?.role !== 'owner') return <p role="alert">Archived scorecards are available to the event owner only.</p>;
  return <section className="owner-scores">
    {overviewHref !== null && <a href={overviewHref ?? `#overview?event=${encodeURIComponent(eventId)}`}>Back to event overview</a>}
    <h1>Round scores</h1>
    <p className="score-warning"><strong>Online only.</strong> Unsaved drafts live only in this page. Keep a paper backup.</p>
    {permissions?.role === 'player' && assignedGroup && <p>Your assigned playing group: Group {assignedGroup.number}. You can view every group; enter scores only for your assigned group.</p>}
    {permissions?.role === 'tester' && <p>Tester link: enter scores for any saved playing group in this event. Game settings are read-only.</p>}
    {permissions?.role === 'public' && <p>Enter scores for any saved playing group in this active event. Organizer settings are read-only.</p>}
    {round && writeIds.length === 0 && <p>Read-only scorecards and results. Score entry is not available for this round.</p>}
    {accessChanged && <p role="alert">Score permissions or playing groups changed. Your drafts are retained for review only. Discard them before starting new entries.</p>}
    {accessChanged && <button disabled={busy} onClick={() => { setScreen('entry'); }}>Review unsaved scores</button>}
    {drafts.size > 0 && <button disabled={busy} onClick={() => {
      currentDrafts.current = new Map(); draftAccess.current = null; setDrafts(new Map());
    }}>Discard unsaved scores</button>}
    {screen === 'entry' && round?.eventStatus === 'active' && !round.setupLocked && <p className="score-warning"><strong>Finish setup first.</strong> The first accepted score locks course, tee, roster, groups and captured indices. Clearing scores does not unlock setup.</p>}
    <div className="score-toolbar">
      <button disabled={busy} onClick={() => { setScreen('cards'); }} aria-pressed={screen === 'cards'}>Scorecards</button>
      <button disabled={busy || writeIds.length === 0 && permissions?.role !== 'owner' || accessChanged} onClick={() => {
        if (permissions?.role === 'player' && assignedGroup) setGroupNumber(assignedGroup.number);
        setScreen('entry');
      }} aria-pressed={screen === 'entry'}>Enter scores</button>
      <button disabled={busy} onClick={() => { setScreen('games'); }} aria-pressed={screen === 'games'}>Games</button>
      <button disabled={busy} onClick={() => { setScreen('leaderboard'); }} aria-pressed={screen === 'leaderboard'}>Leaderboard</button>
      <button aria-label="Refresh saved round" disabled={busy} onClick={() => {
        void refreshSavedRound().catch(() => undefined);
      }}>Refresh</button>
    </div>
    <p className="score-connection" role="status">{busy ? 'Contacting score service…' : stale ? 'Saved data may be stale — refresh to review.' : 'Saved scores loaded.'}
      {drafts.size > 0 || gamesDirty ? ' Auto-check paused for local edits.' : ' Auto-checks while visible.'}</p>
    {error && <p role="alert">{error} {round ? 'Unconfirmed entries are kept on this page.' : 'Private score data is not displayed.'}</p>}
    {notice && <p className="score-notice" role="status">{notice}</p>}
    {gamesDirty && screen !== 'games' && <p className="score-notice" role="status">Unsaved game settings. Open Games to save or cancel them.</p>}
    {screen === 'cards' && round && drafts.size > 0 && <p className="score-notice" role="status">
      {drafts.size} unsaved {drafts.size === 1 ? 'score is' : 'scores are'} not included in this card. Return to Enter scores to save or review them.
    </p>}
    {screen === 'leaderboard' && drafts.size > 0 && <p className="score-notice" role="status">
      Unsaved score entries are not included in this leaderboard. Return to Enter scores to save or review them.
    </p>}
    {!round && !error && <p>Loading scorecards…</p>}
    {round && <>
      {(!group || !hole) && <section aria-label="Choose scoring place">
        <p role="alert">Your scoring place is no longer available in this saved round. Select a valid group and hole before entering scores. No scores have been moved to another place.</p>
        <label>View group<select value={group?.number ?? ''} disabled={busy} onChange={(event) => { setGroupNumber(Number(event.target.value)); }}>
          <option value="" disabled>Choose a group</option>
          {round.groups.map((item) => <option key={item.number} value={item.number}>Group {item.number}</option>)}
        </select></label>
        <label>Jump to hole<select value={hole?.number ?? ''} disabled={busy} onChange={(event) => { setHoleNumber(Number(event.target.value)); }}>
          <option value="" disabled>Choose a hole</option>
          {round.layout.map((item) => <option key={item.number} value={item.number}>Hole {item.number}</option>)}
        </select></label>
      </section>}
      {screen === 'entry' && <p className="score-context">{round.roundName} · {round.courseName} / {(round.playerTees?.length ?? 0) > 0 ? 'Default tee: ' : ''}{round.teeName}
        {(round.playerTees?.length ?? 0) > 0 && ' · Personal tees assigned'}</p>}
      {screen === 'entry' && !canEditGroup && writeIds.length > 0 && !accessChanged && <p>This playing group is read-only. Select your assigned playing group to enter scores.</p>}
      {round.eventStatus === 'archived' && <p role="status">Archived event: owner read-only. Drafts cannot be saved.</p>}
      {screen === 'entry' && group && hole && <GroupHoleEntry groups={round.groups} groupNumber={group.number} layout={round.layout} hole={hole}
        rows={group.playerIds.map((playerId) => {
          const card = cardFor(round, playerId);
          const local = drafts.get(entryKey(playerId, hole.number));
          const personal = scorecardTee(round, playerId);
          const playerHole = scorecardHoles(round, playerId).find((item) => item.number === hole.number);
          return {
            playerId, displayName: card.displayName, saved: savedHole(card, hole.number),
            ...(playerHole ? { hole: playerHole } : {}),
            ...((round.playerTees?.length ?? 0) > 0 ? {
              teeLabel: `${personal?.name ?? round.teeName} / ${personal?.category ?? round.teeCategory} · ${personal ? 'personal' : 'default'} tee`,
            } : {}),
            ...(local ? { draft: local } : {}),
            canReview: local?.conflictAt !== undefined && refreshVersion > local.conflictAt,
          };
        })} busy={busy} readOnly={!canEditGroup} unsavedCount={drafts.size} focusHole={focusHole}
        onGroupChange={(number) => { setGroupNumber(number); setNotice(''); }}
        onHoleChange={(number) => { setHoleNumber(number); setNotice(''); }} onEdit={edit} onReview={review}
        onDiscard={(playerId) => { update(entryKey(playerId, hole.number), null); }}
        onSave={(advance) => { void save(advance); }} />}
      {group && <div hidden={screen !== 'cards'}>
        <SavedScorecards round={round} groupNumber={group.number} busy={busy}
          onGroupChange={setGroupNumber} onEnterScores={() => { setScreen('entry'); }} />
      </div>}
      <div hidden={screen !== 'games'}>
        <RoundGamesPanel round={round} busy={busy} onDirtyChange={gameDirtyChanged}
          onSave={saveGameSettings} onRefresh={refreshSavedRound} />
      </div>
      <div hidden={screen !== 'leaderboard'}>
        <RoundLeaderboard round={round} busy={busy} onManageGames={() => { setScreen('games'); }} />
      </div>
    </>}
  </section>;
}
