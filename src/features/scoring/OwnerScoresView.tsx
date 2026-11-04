import { useEffect, useRef, useState } from 'react';
import type { ScoresClient } from '../../client/scoring';
import type { RoundScores, ScoreChange } from '../../domain/scoring';
import { sameHoleScore } from '../../domain/scoring';
import { useOwnerScores } from './useOwnerScores';
import { SavedScoreLayout } from './ScorecardSummary';
import { GroupHoleEntry } from './GroupHoleEntry';
import { SavedScorecards } from './SavedScorecards';
import type { PlayerHistory } from './SavedScorecards';
import { cardFor, conflictedDraft, editedDraft, entryKey, entryScore, savedHole, scoreLabel } from './entry-state';
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
  const [screen, setScreen] = useState<'entry' | 'cards'>('entry');
  const [histories, setHistories] = useState<ReadonlyMap<string, PlayerHistory>>(new Map());
  const [openHistories, setOpenHistories] = useState<ReadonlySet<string>>(new Set());
  const openHistoryRef = useRef(openHistories);
  const [loadingHistory, setLoadingHistory] = useState<string | null>(null);
  const historyRequest = useRef(false);
  const [acknowledgements, setAcknowledgements] = useState<ReadonlyMap<string, ScoreChange>>(new Map());
  const [notice, setNotice] = useState('');
  const [refreshVersion, setRefreshVersion] = useState(0);
  const saving = useRef(false);
  const alive = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const { round, busy, error, stale, refreshedAt, run, refresh, accept } = useOwnerScores(
    client, eventId, roundId, drafts.size > 0, onSessionExpired,
  );
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
  function acknowledge(change: ScoreChange) {
    setAcknowledgements((previous) => new Map(previous).set(entryKey(change.playerId, change.holeNumber), change));
    setHistories((previous) => {
      const next = new Map(previous);
      next.delete(change.playerId);
      return next;
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
          onProjection: (value) => { latest = value; accept(value); }, onAcknowledged: acknowledge,
        });
      });
      if (result && alive.current) complete(plan.writes.length);
      else if (alive.current) setNotice('No new requests sent. Wait for the active operation or service retry delay, then retry; entries and request IDs are retained.');
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
  async function loadHistory(playerId: string, more = false) {
    if (busy || historyRequest.current) return;
    historyRequest.current = true;
    const previous = histories.get(playerId);
    try {
      const page = await run((signal) => {
        setLoadingHistory(playerId);
        return client.history(eventId, roundId, playerId, signal, more ? previous?.cursor : undefined);
      });
      if (!page || !alive.current) return;
      const changes = more ? [...(previous?.changes ?? []), ...page.changes] : page.changes;
      setHistories((old) => new Map(old).set(playerId, {
        changes: [...new Map(changes.map((change) => [change.id, change])).values()],
        ...(page.continuationToken ? { cursor: page.continuationToken } : {}),
      }));
    } catch { /* The shared request state exposes failures without reopening history. */ }
    finally {
      historyRequest.current = false;
      if (alive.current) setLoadingHistory(null);
    }
  }
  function historyOpen(playerId: string, open: boolean) {
    const next = new Set(openHistoryRef.current);
    if (open) next.add(playerId); else next.delete(playerId);
    openHistoryRef.current = next;
    setOpenHistories(next);
    if (open && !histories.has(playerId)) void loadHistory(playerId);
  }
  return <section className="owner-scores">
    <a href={`#events?event=${eventId}`}>Back to saved event</a>
    <h1>Online owner scorecards</h1>
    <p className="score-warning"><strong>Owner simulation · online only.</strong> Unsaved drafts live only in this page. Keep a paper backup.</p>
    <p className="score-warning"><strong>Finish setup first.</strong> The first accepted score locks course, tee, roster, groups and captured indices. Clearing scores does not unlock setup.</p>
    <div className="score-toolbar">
      <button disabled={busy} onClick={() => { setScreen('entry'); }} aria-pressed={screen === 'entry'}>Enter scores</button>
      <button disabled={busy} onClick={() => { setScreen('cards'); }} aria-pressed={screen === 'cards'}>Scorecards</button>
      <button aria-label="Refresh saved round" disabled={busy} onClick={() => {
        void refresh().then((value) => {
          if (value) {
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
          }
        }).catch(() => undefined);
      }}>Refresh</button>
    </div>
    <p className="score-connection" role="status">{busy ? 'Contacting score service…' : stale ? 'Saved data may be stale — refresh to review.' : 'Saved scores loaded.'}
      {drafts.size > 0 ? ' Auto-check paused for local edits.' : ' Auto-checks while visible.'}</p>
    {error && <p role="alert">{error} Unconfirmed entries and request IDs are retained.</p>}
    {notice && <p className="score-notice" role="status">{notice}</p>}
    {!round && !error && <p>Loading owner-only scorecards…</p>}
    {round && <>
      <p className="score-context">{round.roundName} · {round.courseName} / {round.teeName}</p>
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
      {screen === 'cards' && <SavedScorecards round={round} histories={histories} openHistories={openHistories}
        loadingHistory={loadingHistory} busy={busy}
        onToggle={(playerId) => { historyOpen(playerId, !openHistoryRef.current.has(playerId)); }}
        onClose={(playerId) => { historyOpen(playerId, false); }}
        onLoad={(playerId) => { void loadHistory(playerId); }} onMore={(playerId) => { void loadHistory(playerId, true); }} />}
      <details className="score-secondary"><summary>Saved course & source layout</summary><SavedScoreLayout round={round} /></details>
    </>}
    <details className="score-secondary"><summary>Connection & save details</summary>
      <p>Last server response: {refreshedAt ?? 'not yet loaded'}. One foreground check every 15 seconds; hidden pages and local drafts pause checks. Errors back off, and background execution is not guaranteed. Identity sign-in and view selection do not grant scoring access.</p>
      <p>Only authoritative event owners can score. There is no private offline caching, durable draft storage, golfer admission or finalization. Pickup/DNF are per-hole dispositions, not invented penalties.</p>
      <ul>{round && [...acknowledgements.values()].map((change) => <li key={change.id}>Hole {change.holeNumber}: {scoreLabel(change.before)} → {scoreLabel(change.after)};
        {' '}acknowledged {change.recordedAt}; request {change.id}. Later saved values may differ.</li>)}</ul>
    </details>
  </section>;
}
