import type { FormEvent } from 'react';
import { useId, useState } from 'react';
import { maximumPointsRows, teamSize } from '../../domain/games';
import type { GameDraft } from './game-draft';
import { addBand, buildGame, resetTeamAssignments, setFormat, setPreset, teamDraftFeedback } from './game-draft';

interface GameSettingsProps {
  readonly draft: GameDraft;
  readonly disabled: boolean;
  readonly saveDisabled: boolean;
  readonly cancelDisabled: boolean;
  readonly retry: boolean;
  readonly onChange: (draft: GameDraft) => void;
  readonly onSave: () => void;
  readonly onCancel: () => void;
  readonly roster?: readonly { readonly playerId: string; readonly displayName: string }[];
}

function scoreLabel(value: number): string {
  if (value === 0) return 'Par';
  if (value === -1) return 'Birdie · 1 under';
  if (value === -2) return 'Eagle · 2 under';
  if (value === -3) return 'Albatross · 3 under';
  if (value === 1) return 'Bogey · 1 over';
  if (value === 2) return 'Double bogey · 2 over';
  return value < 0 ? `${String(Math.abs(value))} under par` : `${String(value)} over par`;
}

export function GameSettings({
  draft, disabled, saveDisabled, cancelDisabled, retry, onChange, onSave, onCancel, roster = [],
}: GameSettingsProps) {
  const allowanceHint = useId();
  const [teamQuery, setTeamQuery] = useState('');
  const [golferQuery, setGolferQuery] = useState('');
  const [teamPage, setTeamPage] = useState(0);
  const rosterIds = roster.map((player) => player.playerId);
  const teamFeedback = teamDraftFeedback(draft, rosterIds);
  const assigned = (draft.teams ?? []).flatMap((team) => team.playerIds).filter(Boolean);
  const teams = (draft.teams ?? []).map((team, index) => ({ team, index })).filter(({ team }) =>
    `${team.name} ${team.playerIds.map((id) => roster.find((player) => player.playerId === id)?.displayName ?? '').join(' ')}`
      .toLowerCase().includes(teamQuery.trim().toLowerCase()));
  const pageSize = 6;
  const page = Math.min(teamPage, Math.max(0, Math.ceil(teams.length / pageSize) - 1));
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSave();
  }
  return (
    <form className="game-settings" onSubmit={submit} noValidate aria-label="Game settings">
      <fieldset disabled={disabled}>
        <legend>Edit game</legend>
        <label>Game name
          <input value={draft.name} maxLength={100} onChange={(event) => { onChange({ ...draft, name: event.target.value }); }} />
        </label>
        <label>Points preset
          <select value={draft.preset} onChange={(event) => {
            if (event.target.value === 'standard' || event.target.value === 'modified') {
              onChange(setPreset(draft, event.target.value));
            }
          }}>
            <option value="standard">Standard</option>
            <option value="modified">Modified Stableford</option>
          </select>
        </label>
        <label>Game format
          <select value={draft.format ?? 'individual'} onChange={(event) => {
            const value = event.target.value;
            if (value === 'individual' || value === 'two-net-better-ball' || value === 'two-net-aggregate' || value === 'four-two-net') {
              onChange(setFormat(draft, value === 'individual' ? undefined : value, roster.length));
            }
          }}>
            <option value="individual">Individual Stableford</option>
            <option value="two-net-better-ball">2-man net Better Ball · best one</option>
            <option value="four-two-net">4-man 2-net Stableford · Standard or Modified preset</option>
            <option value="two-net-aggregate">2-man net Aggregate · both count</option>
          </select>
        </label>
        <label>Score basis
          <select value={draft.basis} disabled={draft.format !== undefined} onChange={(event) => {
            if (event.target.value === 'gross' || event.target.value === 'net') {
              onChange({ ...draft, basis: event.target.value });
            }
          }}>
            <option value="gross">Gross</option>
            <option value="net">Net</option>
          </select>
        </label>
        {draft.basis === 'net' && <div><label>Handicap allowance (%)
          <input inputMode="numeric" aria-describedby={allowanceHint} value={draft.allowance}
            onChange={(event) => { onChange({ ...draft, allowance: event.target.value, allowanceConfigured: true }); }} />
        </label><small id={allowanceHint}>Whole percent, 1–100.</small></div>}
        {draft.format && <section className="game-teams" aria-label="Team assignments">
          <h4>Team assignments · this round and game only</h4>
          <p>Teams are separate from playing groups. Assign every current round golfer exactly once. Partners are never chosen automatically.</p>
          <p>{draft.format === 'two-net-better-ball' ? 'Highest one net points score per hole.'
            : draft.format === 'four-two-net' ? 'Highest two net points scores per hole; counting golfers may change each hole.' : 'Both net points scores count each hole.'}
            {' '}Team-hole points remain pending until every teammate has saved individual points.</p>
          {draft.assignmentsCleared && <p role="status">Team size changed. Previous assignments were cleared; choose all members again.</p>}
          <p>{draft.teams?.length ?? 0} teams · {new Set(assigned.filter((id) => rosterIds.includes(id))).size}/{roster.length} golfers assigned</p>
          <label>Find teams or assigned golfers<input type="search" value={teamQuery} onChange={(event) => {
            setTeamQuery(event.target.value); setTeamPage(0);
          }} onKeyDown={(event) => { if (event.key === 'Enter') event.preventDefault(); }} /></label>
          <label>Find golfers for member choices<input type="search" value={golferQuery} onChange={(event) => {
            setGolferQuery(event.target.value);
          }} onKeyDown={(event) => { if (event.key === 'Enter') event.preventDefault(); }} /></label>
          <p>Searching and changing pages keeps all team selections, including choices outside the search.</p>
          {teams.slice(page * pageSize, (page + 1) * pageSize).map(({ team, index: teamIndex }) => <fieldset key={team.id}>
            <legend>Team {teamIndex + 1}</legend>
            <label>Team {teamIndex + 1} name
              <input value={team.name} maxLength={100} onChange={(event) => { onChange({
                ...draft, teams: draft.teams?.map((item) => item.id === team.id ? { ...item, name: event.target.value } : item),
              }); }} />
            </label>
            {team.playerIds.map((playerId, memberIndex) => <label key={memberIndex}>
              Team {teamIndex + 1} member {memberIndex + 1}
              <select value={playerId} onChange={(event) => { onChange({
                ...draft, teams: draft.teams?.map((item) => item.id === team.id ? {
                  ...item, playerIds: item.playerIds.map((id, index) => index === memberIndex ? event.target.value : id),
                } : item),
              }); }}>
                <option value="">Choose golfer</option>
                {playerId && !rosterIds.includes(playerId) && <option value={playerId}>Selected golfer · no longer in round</option>}
                {roster.filter((player) => player.playerId === playerId
                  || player.displayName.toLowerCase().includes(golferQuery.trim().toLowerCase())).map((player) => <option key={player.playerId} value={player.playerId}
                  disabled={player.playerId !== playerId && assigned.includes(player.playerId)}>
                  {player.displayName}{player.playerId !== playerId && assigned.includes(player.playerId) ? ' · already assigned' : ''}
                </option>)}
              </select>
            </label>)}
          </fieldset>)}
          {teams.length === 0 && <p>No teams match your search. All selections are retained.</p>}
          {teams.length > pageSize && <nav className="game-actions" aria-label="Team assignment pages">
            <button type="button" disabled={page === 0} onClick={() => { setTeamPage(page - 1); }}>Previous teams</button>
            <span>Page {page + 1} of {Math.ceil(teams.length / pageSize)}</span>
            <button type="button" disabled={(page + 1) * pageSize >= teams.length} onClick={() => { setTeamPage(page + 1); }}>Next teams</button>
          </nav>}
          <p role="status">{teamFeedback ?? `All ${String(roster.length)} golfers assigned in full ${String(teamSize(draft.format))}-person teams.`}</p>
          {roster.some((player) => !assigned.includes(player.playerId)) && <p>Unassigned golfers: {roster.filter((player) =>
            !assigned.includes(player.playerId)).length}. Use the member choices to assign them manually.</p>}
          {(draft.teams ?? []).flatMap((team) => team.playerIds).length !== roster.length && <div>
            <p>If the roster size changed, reset the team slots to fit the current round. This clears all member selections; assign the teams again before saving.</p>
            <button type="button" disabled={roster.length < teamSize(draft.format) || roster.length % teamSize(draft.format) !== 0}
              onClick={() => { onChange(resetTeamAssignments(draft, roster.length)); }}>Reset team assignments</button>
          </div>}
        </section>}
        <div className="game-scroll" role="region" aria-label="Editable points table" tabIndex={0}>
          <table>
            <caption>Points by strokes relative to par</caption>
            <thead><tr><th scope="col">Relative to par</th><th scope="col">Points</th></tr></thead>
            <tbody>
              <tr><th scope="row">Better than listed</th><td>
                <input aria-label="Better than listed points" inputMode="text" value={draft.better}
                  onChange={(event) => { onChange({ ...draft, better: event.target.value }); }} />
              </td></tr>
              {draft.rows.map((row) => <tr key={row.scoreToPar}>
                <th scope="row">{scoreLabel(row.scoreToPar)}</th>
                <td><input aria-label={`Points at ${String(row.scoreToPar)} relative to par`} inputMode="text"
                  value={row.points} onChange={(event) => { onChange({
                    ...draft, rows: draft.rows.map((item) => item.scoreToPar === row.scoreToPar
                      ? { ...item, points: event.target.value } : item),
                  }); }} /></td>
              </tr>)}
              <tr><th scope="row">Worse than listed</th><td>
                <input aria-label="Worse than listed points" inputMode="text" value={draft.worse}
                  onChange={(event) => { onChange({ ...draft, worse: event.target.value }); }} />
              </td></tr>
            </tbody>
          </table>
        </div>
        <div className="game-actions">
          <button type="button" disabled={draft.rows.length >= maximumPointsRows}
            onClick={() => { onChange(addBand(draft, 'better')); }}>Add better band</button>
          <button type="button" disabled={draft.rows.length >= maximumPointsRows}
            onClick={() => { onChange(addBand(draft, 'worse')); }}>Add worse band</button>
        </div>
        <p className="game-hint">Pickup and DNF receive the lowest configured points. Enter strokes on the scorecard.</p>
      </fieldset>
      <div className="game-actions">
        <button type="submit" disabled={disabled || saveDisabled || draft.format !== undefined && !buildGame(draft, rosterIds)}>{retry ? 'Retry save' : 'Save game'}</button>
        <button type="button" disabled={cancelDisabled} onClick={onCancel}>Cancel editing</button>
      </div>
    </form>
  );
}
