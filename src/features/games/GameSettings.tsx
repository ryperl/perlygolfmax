import type { FormEvent } from 'react';
import { useId, useState } from 'react';
import { maximumPointsRows, teamSize } from '../../domain/games';
import type { RoundGameKind } from '../../domain/games';
import type { GameDraft } from './game-draft';
import { addBand, buildGame, resetTeamAssignments, setFormat, setGameKind, setNassauVariant, setPreset, teamDraftFeedback } from './game-draft';
import type { RoundGroup } from '../../domain/setup';
import { churchyPairs, defaultChurchySpecials } from '../../domain/churchy';
import type { RoundGameDefinition } from '../../domain/games';
import { DotsSettings } from '../dots';

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
  readonly churchyEnabled?: boolean;
  readonly groups?: readonly RoundGroup[];
  readonly setupLocked?: boolean;
  readonly allowChurchyCreation?: boolean;
  readonly supportedGameKinds?: readonly RoundGameKind[] | undefined;
  readonly games?: readonly RoundGameDefinition[];
  readonly internalOnly?: boolean;
  readonly wolfV2Supported?: boolean;
  readonly churchyV2Supported?: boolean;
  readonly dotsV2Supported?: boolean;
  readonly dotsIndividualPlayerCounts?: readonly number[];
  readonly existing?: boolean;
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
  churchyEnabled = false, groups = [], setupLocked = false, allowChurchyCreation = false, supportedGameKinds,
  games = [], internalOnly = false, wolfV2Supported = false, churchyV2Supported = false, dotsV2Supported = false,
  dotsIndividualPlayerCounts = [4], existing = false,
}: GameSettingsProps) {
  const allowanceHint = useId();
  const stableford = draft.kind === undefined || draft.kind === 'stableford';
  const matchGame = draft.kind === 'nassau' || draft.kind === 'wolf';
  const matchLocked = (matchGame || draft.kind === 'dots') && setupLocked;
  const churchyLocked = setupLocked;
  const [teamQuery, setTeamQuery] = useState('');
  const [golferQuery, setGolferQuery] = useState('');
  const [teamPage, setTeamPage] = useState(0);
  const rosterIds = roster.map((player) => player.playerId);
  const dotsPlayerCount = (draft.dotsPlayerIds ?? draft.dotsPlayers ?? []).length;
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
      <fieldset disabled={disabled || matchLocked || draft.kind === 'churchy' && draft.churchyVersion === 2 && !churchyV2Supported}>
        <legend>Edit game</legend>
        <label>Game name
          <input value={draft.name} disabled={draft.kind === 'churchy'} maxLength={100} onChange={(event) => { onChange({ ...draft, name: event.target.value }); }} />
        </label>
        <label>Game type<select value={draft.kind ?? 'stableford'}
          disabled={draft.kind === 'churchy' || existing && (internalOnly || draft.kind === 'wolf' && draft.wolfVersion !== 2)} onChange={(event) => {
          const kind = event.target.value;
          if ((!internalOnly && (kind === 'stableford' || kind === 'ball-drop' || kind === 'skins'))
            || (kind === 'wolf' && (existing || wolfV2Supported)
              || !internalOnly && (kind === 'stroke-play' || kind === 'nassau')) && supportedGameKinds?.includes(kind)
            || kind === 'dots' && supportedGameKinds?.includes('dots')
            || kind === 'churchy' && churchyEnabled && churchyV2Supported && allowChurchyCreation && !setupLocked) onChange(setGameKind(draft, kind, roster.length));
        }}>
          {!internalOnly && <><option value="stableford">Stableford</option><option value="ball-drop">Ball Drop</option><option value="skins">Skins</option>
          <option value="stroke-play" disabled={!supportedGameKinds?.includes('stroke-play')}>Stroke Play</option>
          <option value="nassau" disabled={setupLocked || !supportedGameKinds?.includes('nassau')}>Nassau · Match play</option></>}
          <option value="wolf" disabled={setupLocked || !supportedGameKinds?.includes('wolf') || !existing && !wolfV2Supported}>Wolf / PIG · Earned dots</option>
          <option value="dots" disabled={setupLocked || !supportedGameKinds?.includes('dots')}>Dots · Separate specials</option>
          {churchyEnabled && (draft.kind === 'churchy' || churchyV2Supported && allowChurchyCreation && !churchyLocked) && <option value="churchy">Churchy Game</option>}
        </select></label>
        {stableford && <label>Points preset
          <select value={draft.preset} onChange={(event) => {
            if (event.target.value === 'standard' || event.target.value === 'modified') {
              onChange(setPreset(draft, event.target.value));
            }
          }}>
            <option value="standard">Standard</option>
            <option value="modified">Modified Stableford</option>
          </select>
        </label>}
        {!matchGame && draft.kind !== 'dots' && draft.kind !== 'skins' && draft.kind !== 'churchy' && draft.kind !== 'stroke-play' && <label>Game format
          <select value={draft.format ?? 'individual'} onChange={(event) => {
            const value = event.target.value;
            if (value === 'individual' || value === 'two-net-better-ball' || value === 'two-net-aggregate' || value === 'four-two-net'
              || value === 'ball-drop-net-gross' || value === 'ball-drop-two-net' || value === 'ball-drop-two-gross') {
              onChange(setFormat(draft, value === 'individual' ? undefined : value, roster.length));
            }
          }}>
            {stableford ? <><option value="individual">Individual Stableford</option>
            <option value="two-net-better-ball">2-man net Better Ball · best one</option>
            <option value="four-two-net">4-man 2-net Stableford · Standard or Modified preset</option>
            <option value="two-net-aggregate">2-man net Aggregate · both count</option></> : <>
              <option value="ball-drop-net-gross">1 Net + 1 Gross</option>
              <option value="ball-drop-two-net">2 Net</option><option value="ball-drop-two-gross">2 Gross</option>
            </>}
          </select>
        </label>}
        {draft.kind !== 'churchy' && draft.kind !== 'dots' && <label>Score basis
          <select value={draft.basis} disabled={draft.format !== undefined} onChange={(event) => {
            if (event.target.value === 'gross' || event.target.value === 'net') {
              onChange({ ...draft, basis: event.target.value });
            }
          }}>
            <option value="gross">Gross</option>
            <option value="net">Net</option>
          </select>
        </label>}
        {matchGame && <section aria-label={`${draft.kind === 'wolf' ? 'Wolf' : 'Nassau'} setup`}>
          <p>Configure before this round&apos;s first saved score. Setup and participant order lock once scoring starts.
            Net uses 100% captured Course Handicap off the lowest {draft.kind === 'nassau' ? 'within each match' : 'of the four golfers'}.</p>
          <label>Playing group<select value={draft.groupNumber ?? ''} onChange={(event) => {
            const group = groups.find((entry) => entry.number === Number(event.target.value));
            if (group) onChange({ ...draft, groupNumber: group.number,
              ...(draft.kind === 'wolf' ? { wolfPlayers: group.playerIds } : {
                nassauSides: (draft.nassauSides ?? []).map((side) => ({ ...side, playerIds: side.playerIds.map(() => '') })),
              }) });
          }}><option value="">Choose saved playing group</option>
            {groups.filter((group) => draft.kind !== 'wolf' || group.playerIds.length === 4).map((group) =>
              <option key={group.number} value={group.number}>Group {group.number}</option>)}
          </select></label>
          {draft.kind === 'wolf' ? <>
            <details><summary>Wolf rules</summary><p>Wolf tees last; choose a partner immediately after their drive, before the next drive, or pass all.
              Blind Wolf passes all after seeing drives (double); PIG is declared before any tee shots (triple).
              Timing is honor-system. Ties award zero; no carry.
              {draft.wolfVersion === 2 ? ' Partnered High and Low earn one dot each per winning teammate. Solo Blind Wolf earns two, PIG three, per winning golfer.'
                : ' Legacy transfer-balance rules are preserved; no dollar settlement.'}</p>
              {draft.wolfVersion === 2 && <p>Final two holes: the lowest earned total after the opening 7 or 16 holes chooses Wolf, including explicitly linked Dots.
                Ties use the next printed rotation. Saved selection survives later corrections.</p>}
            </details>
            {(draft.wolfPlayers ?? []).map((id, index) => <label key={index}>Wolf P{index + 1}<select value={id} onChange={(event) => {
              const ids = [...(draft.wolfPlayers ?? [])], other = ids.indexOf(event.target.value);
              if (other >= 0) { ids[other] = id; ids[index] = event.target.value; onChange({ ...draft, wolfPlayers: ids }); }
            }}>{groups.find((group) => group.number === draft.groupNumber)?.playerIds.map((playerId) =>
              <option key={playerId} value={playerId}>{roster.find((entry) => entry.playerId === playerId)?.displayName ?? 'Golfer unavailable'}</option>)}</select></label>)}
            <p>P1–P4 rotate from the saved group&apos;s starting hole.</p>
            {draft.wolfVersion === 2 && <>
              <label>USD per dot difference<span>$ <input aria-label="USD per dot difference" inputMode="decimal" value={draft.stake ?? ''}
                onChange={(event) => { onChange({ ...draft, stake: event.target.value }); }} /></span></label>
              <small>Optional dollars and cents. Blank or 0 means points-only; one individual settlement per opponent.</small>
              {!wolfV2Supported && <p>This API does not advertise earned Wolf editing support.</p>}
            </>}
            {draft.wolfVersion !== 2 && <p>Legacy Wolf · This game will not convert to earned-dot rules.</p>}
            <label>Allow PIG<input type="checkbox" checked={draft.allowPig ?? false} onChange={(event) => { onChange({ ...draft, allowPig: event.target.checked }); }} /></label>
          </> : <>
            <p>18 holes only. Front 1–9, back 10–18 and overall are independent match bets. Ties push; no carry.</p>
            <label>Nassau format<select value={draft.nassauVariant ?? 'singles'} onChange={(event) => {
              const value = event.target.value;
              if (value === 'singles' || value === 'three-way' || value === 'one-v-two' || value === 'two-v-two-best-ball' || value === 'two-v-two-aggregate') onChange(setNassauVariant(draft, value));
            }}><option value="singles">Singles · 1 vs 1</option><option value="three-way">Three-way · three pairwise matches</option>
              <option value="one-v-two">1 vs 2 · Best ball</option><option value="two-v-two-best-ball">2 vs 2 · Best ball</option>
              <option value="two-v-two-aggregate">2 vs 2 · Aggregate</option></select></label>
            {(draft.nassauSides ?? []).map((side, sideIndex) => <fieldset key={side.id}><legend>{side.name}</legend>
              <label>Side {sideIndex + 1} name<input value={side.name} onChange={(event) => { onChange({ ...draft,
                nassauSides: (draft.nassauSides ?? []).map((entry) => entry.id === side.id ? { ...entry, name: event.target.value } : entry) }); }} /></label>
              {side.playerIds.map((id, index) => <label key={index}>{side.name} golfer {index + 1}<select value={id} onChange={(event) => {
                onChange({ ...draft, nassauSides: (draft.nassauSides ?? []).map((entry) => entry.id === side.id
                  ? { ...entry, playerIds: entry.playerIds.map((playerId, position) => position === index ? event.target.value : playerId) } : entry) });
              }}><option value="">Choose participant</option>
                {groups.find((group) => group.number === draft.groupNumber)?.playerIds.map((playerId) =>
                  <option key={playerId} value={playerId} disabled={playerId !== id && draft.nassauSides?.some((entry) => entry.playerIds.includes(playerId))}>
                    {roster.find((entry) => entry.playerId === playerId)?.displayName ?? 'Golfer unavailable'}</option>)}
              </select></label>)}
            </fieldset>)}
            {['Front', 'Back', 'Overall'].map((label, index) => <label key={label}>{label} stake per side · USD $<input inputMode="decimal"
              value={draft.nassauStakes?.[index] ?? ''} onChange={(event) => { onChange({ ...draft,
                nassauStakes: [0, 1, 2].map((position) => position === index ? event.target.value : draft.nassauStakes?.[position] ?? '') }); }} /></label>)}
            <button type="button" onClick={() => { onChange({ ...draft, nassauStakes: ['0', '0', '0'] }); }}>No planned money</button>
            <small>Enter dollars and cents, including explicit 0. No default stake or payment. Presses inherit their parent&apos;s stake and end hole.</small>
            <label>Automatic two-down presses<input type="checkbox" checked={draft.automaticPresses ?? false}
              onChange={(event) => { onChange({ ...draft, automaticPresses: event.target.checked }); }} /></label>
            <p>Manual presses are available from saved results. Each bet may automatically press once; nested presses may do the same, starting next hole.</p>
          </>}
        </section>}
        {draft.kind === 'dots' && <DotsSettings draft={draft} groups={groups} players={roster}
          v2Supported={dotsV2Supported}
          individualPlayerCounts={dotsIndividualPlayerCounts}
          wolves={games.filter((game) => game.kind === 'wolf')} onChange={(patch) => { onChange({ ...draft, ...patch }); }} />}
        {draft.kind === 'churchy' && <section aria-label="Churchy setup">
          {draft.churchyGroup && <h3>Group {draft.churchyGroup} · Churchy Game</h3>}
          <label>Churchy playing group<select value={draft.churchyGroup ?? ''} disabled={churchyLocked} onChange={(event) => {
            const group = groups.find((entry) => entry.number === Number(event.target.value));
            if (group?.playerIds.length === 4) onChange({ ...draft, churchyGroup: group.number, churchyPlayers: group.playerIds });
          }}>
            <option value="">Choose saved foursome</option>
            {groups.filter((entry) => entry.playerIds.length === 4).map((group) => <option key={group.number} value={group.number}>Group {group.number}</option>)}
          </select></label>
          {(draft.churchyPlayers ?? []).map((id, index) => <label key={index}>P{index + 1}<select value={id} disabled={churchyLocked} onChange={(event) => {
            const ids = [...(draft.churchyPlayers ?? [])];
            const previousIndex = ids.indexOf(event.target.value);
            if (previousIndex >= 0) { ids[previousIndex] = id; ids[index] = event.target.value; onChange({ ...draft, churchyPlayers: ids }); }
          }}>{groups.find((group) => group.number === draft.churchyGroup)?.playerIds.map((playerId) => <option key={playerId} value={playerId}>
            {roster.find((player) => player.playerId === playerId)?.displayName ?? 'Golfer unavailable'}
          </option>)}</select></label>)}
          {draft.churchyVersion === 2 && <fieldset disabled={churchyLocked}><legend>Enabled specials · fixed dots</legend>
            {defaultChurchySpecials.map((key) => <label key={key}><input type="checkbox"
              checked={draft.churchySpecials?.includes(key) ?? true} onChange={(event) => {
                const current = draft.churchySpecials ?? defaultChurchySpecials;
                onChange({ ...draft, churchySpecials: event.target.checked ? [...current, key] : current.filter((entry) => entry !== key) });
              }} />{key[0]?.toUpperCase()}{key.slice(1)} · {key === 'birdie' ? '2' : key === 'eagle' ? '4' : key === 'murphy' ? '1 / 2 / 3' : key === 'sweep' ? 'current stake' : '1'}</label>)}
            <small>Other dots always available.</small>
          </fieldset>}
          <details><summary>Partners and rules</summary>
          {[1, 4, 7].map((number) => <p key={number}>Holes {number}–{number + 2} and {number + 9}–{number + 11}: {churchyPairs(draft.churchyPlayers ?? [], number)?.map((pair) =>
            pair.map((id) => roster.find((entry) => entry.playerId === id)?.displayName ?? 'Golfer unavailable').join(' + ')).join(' vs ') ?? 'Choose a foursome'}</p>)}
          <p>High and Low carry independently across all holes. Stakes 1, 2, 3 repeat; sweep adds only the current stake.
            Both partners earn the full dots. Lowest captured Course Handicap plays 0; relative strokes use each golfer&apos;s captured tee.</p>
          {draft.churchyVersion === 2 && <p>Birdie 2 and Eagle 4 require exactly one and two under gross par respectively, never both.
            Sandy counts each qualifying occurrence on exact gross par. Sticky is a scorer-confirmed approach inside the flagstick; Other accepts whole dots.</p>}
          </details>
          <label>USD per dot · $<input aria-label="USD per dot" inputMode="decimal" value={draft.amountPerDotMinor ?? ''} onChange={(event) => {
            onChange({ ...draft, amountPerDotMinor: event.target.value });
          }} /></label>
          <small>{draft.churchyVersion === 2 ? 'Per-opponent planned settlement; 0 is points-only. Nothing paid.'
            : 'Dollars and cents: 1.00 = $1 per dot; 0 = no planned money. Planned shared pot only, no payments.'}</small>
          {churchyLocked && <p>Saved scoring locks foursome and order; the organizer can still edit the planned amount per dot.</p>}
        </section>}
        {draft.kind === 'skins' && <label>Carry tied skins forward
          <input type="checkbox" checked={draft.carryovers ?? false} onChange={(event) => {
            onChange({ ...draft, carryovers: event.target.checked });
          }} />
        </label>}
        {!stableford && !matchGame && draft.kind !== 'churchy' && draft.kind !== 'dots' && <p>Net uses 100% of captured Course Handicap. Numeric saved strokes only; pickup and DNF are ineligible.
          {draft.kind === 'stroke-play' ? ' Lowest score relative to personal par ranks first. Totals remain partial until all holes have numeric scores; pickup or DNF makes a valid stroke total unavailable.'
            : draft.kind === 'skins' ? ' All golfers must save a disposition before a hole is awarded. Final unclaimed skins remain unawarded.'
            : ' The lowest valid two-ball combination counts, from two different golfers. Par is 0, birdie −1, bogey +1. Lowest team total wins.'}</p>}
        {stableford && draft.basis === 'net' && <div><label>Handicap allowance (%)
          <input inputMode="numeric" aria-describedby={allowanceHint} value={draft.allowance}
            onChange={(event) => { onChange({ ...draft, allowance: event.target.value, allowanceConfigured: true }); }} />
        </label><small id={allowanceHint}>Whole percent, 1–100.</small></div>}
        {draft.format && <section className="game-teams" aria-label="Team assignments">
          <h4>Team assignments · this round and game only</h4>
          <p>Teams are separate from playing groups. Assign every current round golfer exactly once. Partners are never chosen automatically.</p>
          {stableford ? <p>{draft.format === 'two-net-better-ball' ? 'Highest one net points score per hole.'
            : draft.format === 'four-two-net' ? 'Highest two net points scores per hole; counting golfers may change each hole.' : 'Both net points scores count each hole.'}
            {' '}Team-hole points remain pending until every teammate has saved individual points.</p>
            : <p>Two different golfers count. Wait for all four saved dispositions; fewer than two numeric scores makes that hole unavailable.</p>}
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
        {stableford && <><div className="game-scroll" role="region" aria-label="Editable points table" tabIndex={0}>
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
        <p className="game-hint">Pickup and DNF receive the lowest configured points. Enter strokes on the scorecard.</p></>}
      </fieldset>
      {matchLocked && <p>Saved scoring locks Dots, Nassau and Wolf setup. Other games can still be edited.</p>}
      {draft.kind === 'churchy' && draft.churchyVersion === 2 && !churchyV2Supported
        && <p>Churchy edits require API rules support. Refresh before editing this game.</p>}
      {draft.kind !== 'churchy' && supportedGameKinds === undefined && <p>This API does not advertise Stroke Play, Wolf or Nassau support. Refresh after an API upgrade to configure these games.</p>}
      <div className="game-actions">
        <button type="submit" disabled={disabled || matchLocked || saveDisabled
          || draft.kind === 'dots' && draft.dotsMode === 'rotating' && !dotsV2Supported
          || draft.kind === 'dots' && (draft.dotsMode ?? 'individual') === 'individual'
            && dotsPlayerCount > 0 && !dotsIndividualPlayerCounts.includes(dotsPlayerCount)
          || draft.kind === 'churchy' && draft.churchyVersion === 2 && !churchyV2Supported
          || draft.format !== undefined && !buildGame(draft, rosterIds)}>{retry ? 'Retry save' : 'Save game'}</button>
        <button type="button" disabled={cancelDisabled} onClick={onCancel}>Cancel editing</button>
      </div>
    </form>
  );
}
