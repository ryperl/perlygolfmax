import { useRef, useState } from 'react';
import type { ScoresClient } from '../../client/scoring';
import { EventChangedError } from '../../client/events';
import type { HoleScore, ScoreChange, Scorecard } from '../../domain/scoring';
import { maximumExactHoleStrokes } from '../../domain/scoring';
import { useOwnerScores } from './useOwnerScores';
import { SavedScoreLayout, ScorecardSummary } from './ScorecardSummary';
import './scoring.css';

interface Draft {
  readonly kind: HoleScore['kind'];
  readonly text: string;
  readonly attempt?: { readonly id: string; readonly etag: string | null };
  readonly conflict?: boolean;
  readonly reviewed?: boolean;
  readonly reviewedEtag?: string | null;
}
interface History {
  readonly changes: readonly ScoreChange[];
  readonly cursor?: string;
  readonly loaded: boolean;
}
function label(score: HoleScore): string {
  switch (score.kind) {
    case 'strokes': return `${String(score.strokes)} strokes`;
    case 'unplayed': return 'Unplayed';
    case 'picked-up': return 'Picked up';
    case 'did-not-finish': return 'DNF (hole)';
  }
}
function scoreFrom(draft: Draft): HoleScore | null {
  if (draft.kind !== 'strokes') return { kind: draft.kind };
  if (!/^[1-9]\d*$/.test(draft.text)) return null;
  const strokes = Number(draft.text);
  return Number.isSafeInteger(strokes) && strokes <= maximumExactHoleStrokes ? { kind: 'strokes', strokes } : null;
}
function draftFrom(score: HoleScore): Draft {
  return { kind: score.kind, text: score.kind === 'strokes' ? String(score.strokes) : '' };
}

export function OwnerScoresView({ client, eventId, roundId, onSessionExpired }: {
  readonly client: ScoresClient;
  readonly eventId: string;
  readonly roundId: string;
  readonly onSessionExpired: (message: string) => void;
}) {
  const [drafts, setDrafts] = useState<ReadonlyMap<string, Draft>>(new Map());
  const currentDrafts = useRef(drafts);
  const [histories, setHistories] = useState<ReadonlyMap<string, History>>(new Map());
  const [notice, setNotice] = useState('');
  const [reviewedRefresh, setReviewedRefresh] = useState(false);
  const saving = useRef(false);
  const { round, busy, error, stale, refreshedAt, run, refresh, accept } = useOwnerScores(
    client, eventId, roundId, drafts.size > 0, onSessionExpired,
  );
  function update(key: string, draft: Draft | null) {
    const next = new Map(currentDrafts.current);
    if (draft) next.set(key, draft); else next.delete(key);
    currentDrafts.current = next;
    setDrafts(next);
  }
  async function save(card: Scorecard, holeNumber: number, draft: Draft, key: string) {
    const score = scoreFrom(draft);
    if (!score || busy || saving.current || draft.conflict && (!draft.reviewed || !draft.attempt && draft.reviewedEtag !== card.etag)) return;
    saving.current = true;
    const attempt = draft.attempt ?? { id: crypto.randomUUID(), etag: card.etag };
    update(key, { ...draft, attempt });
    setNotice('');
    try {
      const result = await run((signal) => client.save(eventId, roundId, card.playerId, holeNumber, score, attempt.etag, attempt.id, signal));
      if (!result) return;
      accept(result.round);
      update(key, null);
      setHistories((previous) => {
        const next = new Map(previous);
        next.delete(card.playerId);
        return next;
      });
      setNotice(`Save acknowledged for ${card.displayName}, hole ${String(holeNumber)}: ${label(result.change.before)} → ${label(result.change.after)} at ${result.change.recordedAt}. Request ${result.change.id}. The saved projection may include later owner edits; review it below.`);
    } catch (failure) {
      if (failure instanceof EventChangedError) {
        update(key, { ...draft, attempt, conflict: true, reviewed: false });
        setReviewedRefresh(false);
      }
    } finally {
      saving.current = false;
    }
  }
  async function loadHistory(playerId: string, more: boolean) {
    try {
      const previous = histories.get(playerId);
      const page = await run((signal) => client.history(eventId, roundId, playerId, signal, more ? previous?.cursor : undefined));
      if (!page) return;
      setHistories((old) => new Map(old).set(playerId, {
        changes: more ? [...(previous?.changes ?? []), ...page.changes] : page.changes,
        ...(page.continuationToken ? { cursor: page.continuationToken } : {}), loaded: true,
      }));
    } catch { /* The connection error remains visible; existing history is retained. */ }
  }
  return <section className="owner-scores">
    <a href={`#events?event=${eventId}`}>Back to saved event</a>
    <h1>Online owner scorecards</h1>
    <p className="panel">ONLINE OWNER SIMULATION — not golfer admission. Scores require a connection. Unsaved drafts live only in this page; there is no offline persistence or synchronization. Keep a paper backup. Foreground polling is not guaranteed background execution.</p>
    <p className="panel"><strong>Finish setup before saving the first score.</strong> The first accepted score locks this saved round's course, tee, players, groups and captured Handicap Index inputs. Clearing scores does not unlock these inputs.</p>
    <button disabled={busy} onClick={() => {
      void refresh().then((value) => {
        if (value) { setReviewedRefresh(true); setNotice('Saved round refreshed. Local drafts are preserved. Compare saved values before reviewing a conflict.'); }
      }).catch(() => undefined);
    }}>Refresh saved round</button>
    <p role="status">{busy ? 'Contacting score service…' : stale ? 'Stale / not yet verified. Retry a manual refresh.' : 'Saved server projection loaded.'}
      {' '}Last server response: {refreshedAt ?? 'not yet loaded'}.
      {drafts.size > 0 ? ' Automatic polling paused while local drafts exist; refresh manually without losing drafts.' : ' Checks for persisted owner activity every 15 seconds while this page is visible; failures back off.'}</p>
    {error && <p role="alert">{error} Failed inputs and request IDs are retained; a network failure does not prove a save failed.</p>}
    {notice && <p role="status">{notice}</p>}
    {!round && !error && <p>Loading owner-only scorecards…</p>}
    {round && <>
      <h2>{round.eventName} — {round.roundName}</h2>
      <SavedScoreLayout round={round} />
      {round.eventStatus === 'archived' && <p>Archived event: owner read-only. Drafts cannot be saved.</p>}
      {round.setupLocked && <p>Scoring has started: saved course, tee, roster, groups and captured indices are locked. Clearing scores cannot unlock setup.</p>}
      <p>Roster/group order only — not a leaderboard. Gross totals are complete only when every hole has numeric strokes. Picked-up and DNF are hole dispositions, not zero or invented penalties.</p>
      {round.groups.map((group) => <section key={group.number}><h2>Group {group.number}</h2>
        {group.playerIds.map((id) => {
          const card = round.cards.find((item) => item.playerId === id);
          if (!card) return null;
          const history = histories.get(id);
          return <article className="panel" key={id} aria-label={`${card.displayName} scorecard`}>
            <h3>{card.displayName}</h3>
            <ScorecardSummary card={card} />
            <div className="score-holes">{card.holes.map((hole) => {
              const key = `${id}:${String(hole.number)}`;
              const local = drafts.get(key);
              const draft = local ?? draftFrom(hole.score);
              const draftScore = scoreFrom(draft);
              const disabled = busy || round.eventStatus === 'archived';
              const reviewed = local?.reviewed === true && (local.attempt !== undefined || local.reviewedEtag === card.etag);
              const prefix = `${card.displayName} hole ${String(hole.number)}`;
              return <form className="score-hole" aria-label={prefix} key={hole.number} onSubmit={(event) => {
                event.preventDefault();
                if (local) void save(card, hole.number, local, key);
              }}>
                <h4>Hole {hole.number}</h4>
                <p>Saved: {label(hole.score)}</p>
                <label>{prefix} disposition<select disabled={disabled} value={draft.kind} onChange={(event) => {
                  const kind = event.target.value;
                  if (kind === 'unplayed' || kind === 'strokes' || kind === 'picked-up' || kind === 'did-not-finish') {
                    update(key, { kind, text: kind === 'strokes' ? draft.text : '', ...(draft.conflict ? { conflict: true, reviewed: false } : {}) });
                  }
                }}>
                  <option value="unplayed">Unplayed / clear</option><option value="strokes">Strokes</option>
                  <option value="picked-up">Picked up</option><option value="did-not-finish">DNF (hole)</option>
                </select></label>
                {draft.kind === 'strokes' && <label>{prefix} strokes<input disabled={disabled} inputMode="numeric" value={draft.text} onChange={(event) => {
                  update(key, { kind: 'strokes', text: event.target.value, ...(draft.conflict ? { conflict: true, reviewed: false } : {}) });
                }} /></label>}
                {local && <p>Local draft: {draftScore ? label(draftScore) : 'Enter a positive whole exact-safe stroke count; blank is not zero.'} — not confirmed saved.</p>}
                {local?.attempt && <p>Request ID: {local.attempt.id}</p>}
                {local?.conflict && <div role="alert"><p>Another owner changed this card. Draft preserved. Refresh the saved round, compare saved vs draft, then explicitly review before retrying.</p>
                  <button type="button" disabled={disabled || !reviewedRefresh || reviewed} onClick={() => {
                    update(key, { kind: local.kind, text: local.text, conflict: true, reviewed: true, reviewedEtag: card.etag });
                  }}>I reviewed saved vs draft for hole {hole.number}</button>
                </div>}
                <button disabled={disabled || !local || !draftScore || local.conflict && !reviewed}>Save hole {hole.number}</button>
                {local && <button type="button" disabled={disabled} onClick={() => { update(key, null); }}>Discard local draft for hole {hole.number}</button>}
              </form>;
            })}</div>
            <button disabled={busy} onClick={() => { void loadHistory(id, false); }}>Load audit history for {card.displayName}</button>
            {history?.loaded && <section aria-label={`${card.displayName} audit history`}>
              {history.changes.length === 0 ? <p>No recorded changes.</p> : <ol>{history.changes.map((change) => <li key={change.id}>
                Hole {change.holeNumber}: {label(change.before)} → {label(change.after)}; actor {change.recordedBy.tenantId}/{change.recordedBy.objectId};
                {' '}<time dateTime={change.recordedAt}>{change.recordedAt}</time>; request {change.id}
              </li>)}</ol>}
              {history.cursor && <button disabled={busy} onClick={() => { void loadHistory(id, true); }}>More history for {card.displayName}</button>}
            </section>}
          </article>;
        })}
      </section>)}
    </>}
  </section>;
}
