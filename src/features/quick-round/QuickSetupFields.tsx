import { useState } from 'react';
import type { TeeProfile } from '../../domain/catalog';
import type { QuickCourse } from '../../domain/quick-round';
import type { EventSetupInput, RoundSetupInput } from '../../domain/setup';
import type { PlayerCourseHandicap } from '../../domain/scoring';
import { compatibleTeeLayouts } from '../../domain/tees';
import { calculateCourseHandicap } from '../../domain/stableford';
import { CourseHandicap } from '../scoring';

export function QuickSetupFields({ draft, courses, players, profiles, courseHandicaps, locked, disabled, full, onChange }: {
  readonly draft: EventSetupInput;
  readonly courses: readonly QuickCourse[];
  readonly players: readonly { readonly id: string; readonly displayName: string; readonly handicapIndexValue?: string | null }[];
  readonly profiles: readonly TeeProfile[];
  readonly courseHandicaps?: readonly PlayerCourseHandicap[] | undefined;
  readonly locked: boolean;
  readonly disabled: boolean;
  readonly full: boolean;
  readonly onChange: (value: EventSetupInput) => void;
}) {
  const [courseQuery, setCourseQuery] = useState('');
  const [playerQuery, setPlayerQuery] = useState('');
  const [page, setPage] = useState(0);
  const [error, setError] = useState('');
  const round = draft.rounds[0];
  if (!round) return null;
  const common = profiles.find((profile) => profile.id === round.teeProfileId);
  const compatible = common ? profiles.filter((profile) => compatibleTeeLayouts(common, profile)) : [];
  const matches = players.filter((player) => player.displayName.toLowerCase().includes(playerQuery.trim().toLowerCase()));
  const last = Math.max(0, Math.ceil(matches.length / 12) - 1);
  const visible = matches.slice(Math.min(page, last) * 12, (Math.min(page, last) + 1) * 12);
  const selected = draft.playerIds.map((id) => players.find((player) => player.id === id));
  function changeRound(value: RoundSetupInput) { onChange({ ...draft, rounds: [value] }); }
  function togglePlayer(playerId: string) {
    if (!round) return;
    setError('');
    if (draft.playerIds.includes(playerId)) {
      onChange({ ...draft, playerIds: draft.playerIds.filter((id) => id !== playerId), rounds: [{ ...round,
        groups: round.groups.map((group) => ({ ...group, playerIds: group.playerIds.filter((id) => id !== playerId) })).filter((group) => group.playerIds.length),
        playerTeeSelections: round.playerTeeSelections?.filter((entry) => entry.playerId !== playerId) ?? [],
      }] });
      return;
    }
    const available = round.groups.find((group) => group.playerIds.length < 4);
    const groups = available ? round.groups.map((group) => group.number === available.number
      ? { ...group, playerIds: [...group.playerIds, playerId] } : group)
      : [...round.groups, { number: Math.max(0, ...round.groups.map((group) => group.number)) + 1,
        playerIds: [playerId], ...(common?.holes[0] ? { startingHole: common.holes[0].number } : {}) }];
    onChange({ ...draft, playerIds: [...draft.playerIds, playerId], rounds: [{ ...round, groups }] });
  }
  function assign(playerId: string, number: number) {
    if (!round) return;
    if ((round.groups.find((group) => group.number === number)?.playerIds.length ?? 0) >= 4) {
      setError('Each playing group holds at most four golfers. Choose another group.'); return;
    }
    setError('');
    const groups = round.groups.map((group) => ({ ...group, playerIds: group.playerIds.filter((id) => id !== playerId) }));
    const target = groups.find((group) => group.number === number);
    changeRound({ ...round, groups: (target ? groups.map((group) => group.number === number
      ? { ...group, playerIds: [...group.playerIds, playerId] } : group)
      : [...groups, { number, playerIds: [playerId], ...(common?.holes[0] ? { startingHole: common.holes[0].number } : {}) }])
      .filter((group) => group.playerIds.length).sort((a, b) => a.number - b.number) });
  }
  const nextGroup = Math.max(0, ...round.groups.map((group) => group.number)) + 1;
  return <>
    {full && <fieldset disabled={disabled}>
      <legend>Round details</legend>
      <label>Event name<input maxLength={100} value={draft.name} onChange={(event) => { onChange({ ...draft, name: event.target.value }); }} /></label>
      <label>Round name<input maxLength={100} value={round.name} disabled={locked} onChange={(event) => { changeRound({ ...round, name: event.target.value }); }} /></label>
      <label>Location<input maxLength={200} value={draft.location} onChange={(event) => { onChange({ ...draft, location: event.target.value }); }} /></label>
      <label>Round date<input type="date" value={round.startDate ?? ''} onChange={(event) => {
        onChange({ ...draft, startDate: event.target.value, rounds: [{ ...round, startDate: event.target.value }] });
      }} /></label>
      <label>Tee time<input type="time" value={round.teeTime ?? ''} onChange={(event) => { changeRound({ ...round, teeTime: event.target.value }); }} /></label>
    </fieldset>}
    {locked && <p>Scoring has started. Course, tees, golfers and groups are locked.</p>}
    <fieldset disabled={disabled || locked}>
      <legend>Course and golfers</legend>
      <label>Find saved courses<input type="search" value={courseQuery} onChange={(event) => { setCourseQuery(event.target.value); }} /></label>
      <label>Course<select value={round.courseId} onChange={(event) => {
        const course = courses.find((entry) => entry.id === event.target.value);
        changeRound({ ...round, courseId: course?.id ?? '', courseVersionId: course?.latestVersionId ?? '', teeProfileId: 0,
          playerTeeSelections: [], groups: round.groups.map(({ number, playerIds }) => ({ number, playerIds })) });
      }}><option value="">Choose a saved course</option>
        {courses.filter((course) => course.id === round.courseId || course.name.toLowerCase().includes(courseQuery.trim().toLowerCase()))
          .map((course) => <option key={course.id} value={course.id}>{course.name}</option>)}
      </select></label>
      <label>Default tee<select value={round.teeProfileId} onChange={(event) => {
        const tee = profiles.find((profile) => profile.id === Number(event.target.value));
        changeRound({ ...round, teeProfileId: tee?.id ?? 0, playerTeeSelections: [],
          groups: round.groups.map((group) => ({ ...group, startingHole: group.startingHole !== undefined && tee?.holes.some((hole) => hole.number === group.startingHole)
            ? group.startingHole : tee?.holes[0]?.number ?? 1 })) });
      }}><option value={0}>Choose a tee</option>{profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name} / {profile.category}</option>)}</select></label>
      <label>Find saved golfers<input type="search" value={playerQuery} onChange={(event) => { setPlayerQuery(event.target.value); setPage(0); }} /></label>
      <div className="quick-golfer-options">{visible.map((player) => <label key={player.id}>
        <input type="checkbox" checked={draft.playerIds.includes(player.id)} onChange={() => { togglePlayer(player.id); }} />
        {player.displayName}
      </label>)}</div>
      {matches.length > 12 && <div className="quick-actions">
        <button type="button" disabled={page === 0} onClick={() => { setPage((value) => value - 1); }}>Previous golfers</button>
        <span>Page {Math.min(page, last) + 1} of {last + 1}</span>
        <button type="button" disabled={page >= last} onClick={() => { setPage((value) => value + 1); }}>Next golfers</button>
      </div>}
      {matches.length === 0 && <p>No saved golfers match.</p>}
      {full && <label><input type="checkbox" checked={draft.allowPerGolferTees ?? false} onChange={(event) => {
        onChange({ ...draft, allowPerGolferTees: event.target.checked,
          rounds: [{ ...round, playerTeeSelections: event.target.checked ? round.playerTeeSelections ?? [] : [] }] });
      }} />Personal tees</label>}
      {error && <p role="alert">{error}</p>}
      {selected.length > 0 && <h3>Playing groups</h3>}
      {round.groups.map((group) => <section key={group.number} className="quick-group" aria-label={`Group ${String(group.number)}`}>
        <h4>Group {group.number}</h4>
        <label>Group {group.number} starting hole<select value={group.startingHole ?? common?.holes[0]?.number ?? 1}
          onChange={(event) => { changeRound({ ...round, groups: round.groups.map((entry) => entry.number === group.number
            ? { ...entry, startingHole: Number(event.target.value) } : entry) }); }}>
          {(common?.holes ?? []).map((hole) => <option key={hole.number} value={hole.number}>{hole.number}</option>)}
        </select></label>
        {group.playerIds.map((id) => {
          const player = players.find((entry) => entry.id === id);
          const tee = profiles.find((profile) => profile.id === round.playerTeeSelections?.find((entry) => entry.playerId === id)?.teeProfileId) ?? common;
          const handicap = player?.handicapIndexValue === undefined ? 'uncaptured-handicap-index'
            : player.handicapIndexValue === null ? 'missing-handicap-index'
            : !tee ? 'missing-tee-ratings' : calculateCourseHandicap(player.handicapIndexValue, tee);
          return <div key={id} className="quick-player">
            <p>{player?.displayName ?? 'Saved golfer'} · <CourseHandicap className="quick-handicap"
              value={locked && courseHandicaps !== undefined ? courseHandicaps.find((entry) => entry.playerId === id)
                : typeof handicap === 'number' ? { playerId: id, courseHandicap: handicap }
                : { playerId: id, courseHandicap: null, unavailableReason: handicap }} /></p>
            <label>{player?.displayName ?? 'Saved golfer'} group<select value={group.number} onChange={(event) => { assign(id, Number(event.target.value)); }}>
              {round.groups.map((entry) => <option key={entry.number} value={entry.number}>Group {entry.number}</option>)}
              <option value={nextGroup}>New group {nextGroup}</option>
            </select></label>
            {full && draft.allowPerGolferTees && <label>{player?.displayName ?? 'Saved golfer'} tee<select value={tee?.id ?? 0} onChange={(event) => {
              changeRound({ ...round, playerTeeSelections: [...(round.playerTeeSelections ?? []).filter((entry) => entry.playerId !== id),
                { playerId: id, teeProfileId: Number(event.target.value) }] });
            }}>{compatible.map((profile) => <option key={profile.id} value={profile.id}>{profile.name} / {profile.category}</option>)}</select></label>}
            <button type="button" onClick={() => { togglePlayer(id); }}>Remove {player?.displayName ?? 'saved golfer'}</button>
          </div>;
        })}
      </section>)}
    </fieldset>
  </>;
}
