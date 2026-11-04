import { useCallback, useEffect, useRef, useState } from 'react';
import type { ScoresClient } from '../../client/scoring';
import { EventChangedError } from '../../client/events';
import type { GameWriteResult, RoundScores } from '../../domain/scoring';
import type { RoundGameDefinition } from '../../domain/games';
import { RoundGamesPanel } from '../games';
import { sameHoleScore } from '../../domain/scoring';
import { useOwnerScores } from './useOwnerScores';
import { GroupHoleEntry } from './GroupHoleEntry';
import { SavedScorecards } from './SavedScorecards';
import { cardFor, conflictedDraft, editedDraft, entryKey, entryScore, savedHole } from './entry-state';
import type { HoleDraft } from './entry-state';
import { planGroup, saveGroupEntries } from './save-group';
import './scoring.css';

interface OwnerScoresViewProps {
  readonly client: ScoresClient;
  readonly eventId: string;
  readonly roundId: string;
  readonly onSessionExpired: (message: string) => void;
}

export function OwnerScoresView(props: OwnerScoresViewProps) {
  return <OwnerScoresController key={`${props.eventId}:${props.roundId}`} {...props} />;
}

function OwnerScoresController({ client, eventId, roundId, onSessionExpired }: OwnerScoresViewProps) {
  const [drafts, setDrafts] = useState<ReadonlyMap<string, HoleDraft>>(new Map());
  const currentDrafts = useRef(drafts);
  const [groupNumber, setGroupNumber] = useState<number | null>(null);
  const [holeNumber, setHoleNumber] = useState<number | null>(null);
  const [screen, setScreen] = useState<'entry' | 'cards' | 'games'>('cards');
  const [gamesDirty, setGamesDirty] = useState(false);
  const [notice, setNotice] = useState('');
  const [refreshVersion, setRefreshVersion] = useState(0);
  const saving = useRef(false);
  const alive = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const { round, busy, error, stale, run, refresh, accept, pauseForEdit } = useOwnerScores(
    client, eventId, roundId, drafts.size > 0 || gamesDirty, onSessionExpired,
  );
  const gameDirtyChanged = useCallback((dirty: boolean) => {
    if (dirty) pauseForEdit();
    setGamesDirty(dirty);
  }, [pauseForEdit]);
  const group = round?.groups.find((item) => item.number === groupNumber) ?? round?.groups[0];
  const hole = round?.layout.find((item) => item.number === holeNumber) ?? round?.layout[0];

  function update(key: string, draft: HoleDraft | null) {
    const next = new Map(currentDrafts.current);
    if (draft) next.set(key, draft); else next.delete(key);
    currentDrafts.current = next;
    setDrafts(next);
  }
  function edit(playerId: string, text: string) {
    if (!round || !hole || busy || saving.current || round.eventStatus !== 'active') return;
    pauseForEdit();
    const key = entryKey(playerId, hole.number);
    update(key, editedDraft(text, cardFor(round, playerId), currentDrafts.current.get(key)));
    setNotice('');
  }
  function review(playerId: string) {
    if (!round || !hole || busy || round.eventStatus !== 'active') return;
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
    if (!round || round.eventStatus !== 'active') throw new EventChangedError('This round is read-only. Refresh before changing games.');
    return run(async (signal) => {
      const result = await client.saveGames(eventId, roundId, games, etag, requestId, signal);
      signal.throwIfAborted();
      accept(result.round);
      return result;
    });
  }
  async function save(advance: boolean) {
    if (!round || !group || !hole || busy || saving.current || round.eventStatus !== 'active') return;
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
      setNotice(`${writes === 0 ? 'No changes sent' : `${String(writes)} player changes acknowledged`}; ${String(unplayed)} unplayed.${movement}`);
      if (advance && next) setHoleNumber(next.number);
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
  return <section className="owner-scores">
    <a href={`#events?event=${eventId}`}>Back to saved event</a>
    <h1>Round scores</h1>
    <p className="score-warning"><strong>Owner simulation · online only.</strong> Unsaved drafts live only in this page. Keep a paper backup.</p>
    {screen === 'entry' && round?.eventStatus === 'active' && !round.setupLocked && <p className="score-warning"><strong>Finish setup first.</strong> The first accepted score locks course, tee, roster, groups and captured indices. Clearing scores does not unlock setup.</p>}
    <div className="score-toolbar">
      <button disabled={busy} onClick={() => { setScreen('cards'); }} aria-pressed={screen === 'cards'}>Scorecards</button>
      <button disabled={busy} onClick={() => { setScreen('entry'); }} aria-pressed={screen === 'entry'}>Enter scores</button>
      <button disabled={busy} onClick={() => { setScreen('games'); }} aria-pressed={screen === 'games'}>Games</button>
      <button aria-label="Refresh saved round" disabled={busy} onClick={() => {
        void refreshSavedRound().catch(() => undefined);
      }}>Refresh</button>
    </div>
    <p className="score-connection" role="status">{busy ? 'Contacting score service…' : stale ? 'Saved data may be stale — refresh to review.' : 'Saved scores loaded.'}
      {drafts.size > 0 || gamesDirty ? ' Auto-check paused for local edits.' : ' Auto-checks while visible.'}</p>
    {error && <p role="alert">{error} Unconfirmed entries are kept on this page.</p>}
    {notice && <p className="score-notice" role="status">{notice}</p>}
    {gamesDirty && screen !== 'games' && <p className="score-notice" role="status">Unsaved game settings. Open Games to save or cancel them.</p>}
    {screen === 'cards' && round && drafts.size > 0 && <p className="score-notice" role="status">
      {drafts.size} unsaved {drafts.size === 1 ? 'score is' : 'scores are'} not included in this card. Return to Enter scores to save or review them.
    </p>}
    {!round && !error && <p>Loading owner-only scorecards…</p>}
    {round && <>
      {screen === 'entry' && <p className="score-context">{round.roundName} · {round.courseName} / {round.teeName}</p>}
      {round.eventStatus === 'archived' && <p role="status">Archived event: owner read-only. Drafts cannot be saved.</p>}
      {screen === 'entry' && group && hole && <GroupHoleEntry groups={round.groups} groupNumber={group.number} layout={round.layout} hole={hole}
        rows={group.playerIds.map((playerId) => {
          const card = cardFor(round, playerId);
          const local = drafts.get(entryKey(playerId, hole.number));
          return {
            playerId, displayName: card.displayName, saved: savedHole(card, hole.number),
            ...(local ? { draft: local } : {}),
            canReview: local?.conflictAt !== undefined && refreshVersion > local.conflictAt,
          };
        })} busy={busy} readOnly={round.eventStatus === 'archived'} unsavedCount={drafts.size}
        onGroupChange={setGroupNumber} onHoleChange={setHoleNumber} onEdit={edit} onReview={review}
        onDiscard={(playerId) => { update(entryKey(playerId, hole.number), null); }}
        onSave={(advance) => { void save(advance); }} />}
      {screen === 'cards' && group && <SavedScorecards round={round} groupNumber={group.number} busy={busy}
        onGroupChange={setGroupNumber} onEnterScores={() => { setScreen('entry'); }} />}
      <div hidden={screen !== 'games'}>
        <RoundGamesPanel round={round} busy={busy} onDirtyChange={gameDirtyChanged}
          onSave={saveGameSettings} onRefresh={refreshSavedRound} />
      </div>
    </>}
  </section>;
}
