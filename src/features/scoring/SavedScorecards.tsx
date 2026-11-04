import type { RoundScores, ScoreChange } from '../../domain/scoring';
import { ScorecardSummary } from './ScorecardSummary';
import { scoreLabel } from './entry-state';
import { PlayerScorecardRecap } from './PlayerScorecardRecap';

export interface PlayerHistory {
  readonly changes: readonly ScoreChange[];
  readonly cursor?: string;
}
export function SavedScorecards({ round, histories, openHistories, loadingHistory, busy, onToggle, onClose, onLoad, onMore }: {
  readonly round: RoundScores;
  readonly histories: ReadonlyMap<string, PlayerHistory>;
  readonly openHistories: ReadonlySet<string>;
  readonly loadingHistory: string | null;
  readonly busy: boolean;
  readonly onToggle: (playerId: string) => void;
  readonly onClose: (playerId: string) => void;
  readonly onLoad: (playerId: string) => void;
  readonly onMore: (playerId: string) => void;
}) {
  return <section aria-label="Saved scorecards">
    <h2>Saved scorecards</h2>
    <p>Saved roster/group order, not a ranking. Pickup reported strokes count toward recorded strokes, never a completed gross result.</p>
    {round.groups.map((group) => <section key={group.number}><h3>Group {group.number}</h3>
      {group.playerIds.map((id) => {
        const card = round.cards.find((item) => item.playerId === id);
        if (!card) return null;
        const history = histories.get(id);
        const open = openHistories.has(id);
        const panelId = `score-history-${id}`;
        return <article className="panel saved-scorecard" key={id} aria-label={`${card.displayName} saved scorecard`}>
          <h4>{card.displayName}</h4>
          <ScorecardSummary card={card} />
          <details><summary>Full scorecard for {card.displayName}</summary>
            <PlayerScorecardRecap round={round} card={card} />
          </details>
          <button type="button" aria-expanded={open} aria-controls={panelId} onClick={() => { onToggle(id); }}>History for {card.displayName}</button>
          <section id={panelId} hidden={!open} aria-label={`${card.displayName} audit history`}>
            <button type="button" onClick={() => { onClose(id); }}>Close history for {card.displayName}</button>
            {loadingHistory === id ? <p role="status">Loading history…</p> : !history
              ? <button type="button" disabled={busy} onClick={() => { onLoad(id); }}>Load history for {card.displayName}</button> : null}
            {history && (history.changes.length === 0 ? <p>No recorded changes.</p> : <ol>{history.changes.map((change) => <li key={change.id}>
              Hole {change.holeNumber}: {scoreLabel(change.before)} → {scoreLabel(change.after)};
              {' '}<time dateTime={change.recordedAt}>{change.recordedAt}</time>;
              {' '}actor {change.recordedBy.tenantId}/{change.recordedBy.objectId}
              <details><summary>Operation details</summary>Request {change.id}; expected card revision {change.expectedEtag ?? 'new card'}.</details>
            </li>)}</ol>)}
            {history?.cursor && <button type="button" disabled={busy} onClick={() => { onMore(id); }}>More history for {card.displayName}</button>}
          </section>
        </article>;
      })}
    </section>)}
  </section>;
}
