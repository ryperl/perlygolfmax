import { useState } from 'react';
import type { TeeProfile } from '../../domain/catalog';
import type { QuickCourse } from '../../domain/quick-round';
import type { EventSetupInput, RoundSetupInput } from '../../domain/setup';
import type { PlayerCourseHandicap } from '../../domain/scoring';
import { compatibleTeeLayouts } from '../../domain/tees';
import { calculateCourseHandicap } from '../../domain/stableford';
import { CourseHandicap } from '../scoring';
import { roundTee } from '../../domain/round-tee';
import { QuickPlayerPicker } from './QuickPlayerPicker';

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
  const [editingGroups, setEditingGroups] = useState<readonly number[]>([]);
  const [error, setError] = useState('');
  const round = draft.rounds[0];
  if (!round) return null;
  const sourceTee = profiles.find((profile) => profile.id === round.teeProfileId);
  const playingProfiles = profiles.flatMap((profile) => {
    const selected = locked && profile.holeCount === 9 ? profile : roundTee(profile, round.roundSide);
    return selected ? [selected] : [];
  });
  const common = playingProfiles.find((profile) => profile.id === round.teeProfileId);
  const compatible = common ? playingProfiles.filter((profile) => compatibleTeeLayouts(common, profile)) : [];
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
    if (round.groups.find((group) => group.number === number)?.playerIds.includes(playerId)) return;
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
  function handicapFor(id: string): PlayerCourseHandicap | undefined {
    const player = players.find((entry) => entry.id === id);
    const tee = playingProfiles.find((profile) => profile.id === round?.playerTeeSelections?.find((entry) => entry.playerId === id)?.teeProfileId) ?? common;
    const handicap = player?.handicapIndexValue === undefined ? 'uncaptured-handicap-index'
      : player.handicapIndexValue === null ? 'missing-handicap-index'
        : !tee ? 'missing-tee-ratings' : calculateCourseHandicap(player.handicapIndexValue, tee);
    return locked && courseHandicaps !== undefined ? courseHandicaps.find((entry) => entry.playerId === id)
      : typeof handicap === 'number' ? { playerId: id, courseHandicap: handicap }
        : { playerId: id, courseHandicap: null, unavailableReason: handicap };
  }
  const nextGroup = Math.max(0, ...round.groups.map((group) => group.number)) + 1;
  return <>
    <fieldset disabled={disabled}>
      <legend>Round details</legend>
      <label>{locked ? 'Event name' : 'Round / event name'}<input required maxLength={100} value={draft.name} onChange={(event) => {
        onChange({ ...draft, name: event.target.value, rounds: [{ ...round, name: locked ? round.name : event.target.value }] });
      }} /></label>
      {round.name !== draft.name && <p className="quick-picker-count">Saved round name: {round.name}{locked ? ' · Locked after scoring' : ''}</p>}
      {full && <>
      <label>Location<input maxLength={200} value={draft.location} onChange={(event) => { onChange({ ...draft, location: event.target.value }); }} /></label>
      <label>Round date<input type="date" value={round.startDate ?? ''} onChange={(event) => {
        onChange({ ...draft, startDate: event.target.value, rounds: [{ ...round, startDate: event.target.value }] });
      }} /></label>
      <label>Tee time<input type="time" value={round.teeTime ?? ''} onChange={(event) => { changeRound({ ...round, teeTime: event.target.value }); }} /></label>
      </>}
    </fieldset>
    {locked && <p>Scoring has started. Course, tees, golfers and groups are locked.</p>}
    <fieldset disabled={disabled || locked}>
      <legend>Course</legend>
      <label>Find saved courses<input type="search" value={courseQuery} onChange={(event) => { setCourseQuery(event.target.value); }} /></label>
      <label>Course<select value={round.courseId} onChange={(event) => {
        const course = courses.find((entry) => entry.id === event.target.value);
        changeRound({ ...round, courseId: course?.id ?? '', courseVersionId: course?.latestVersionId ?? '', teeProfileId: 0, roundSide: 'full',
          playerTeeSelections: [], groups: round.groups.map(({ number, playerIds }) => ({ number, playerIds })) });
      }}><option value="">Choose a saved course</option>
        {courses.filter((course) => course.id === round.courseId || course.name.toLowerCase().includes(courseQuery.trim().toLowerCase()))
          .map((course) => <option key={course.id} value={course.id}>{course.name}</option>)}
      </select></label>
      <label>Default tee<select value={round.teeProfileId} onChange={(event) => {
        const source = profiles.find((profile) => profile.id === Number(event.target.value));
        const side = source?.holeCount === 18 ? round.roundSide ?? 'full' : 'full';
        const tee = source && roundTee(source, side);
        changeRound({ ...round, teeProfileId: tee?.id ?? 0, roundSide: side, playerTeeSelections: [],
          groups: round.groups.map((group) => ({ ...group, startingHole: group.startingHole !== undefined && tee?.holes.some((hole) => hole.number === group.startingHole)
            ? group.startingHole : tee?.holes[0]?.number ?? 1 })) });
      }}><option value={0}>Choose a tee</option>{profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name} / {profile.category} / {profile.holeCount} holes</option>)}</select></label>
      <label>Round holes<select value={round.roundSide ?? 'full'} disabled={sourceTee?.holeCount !== 18} onChange={(event) => {
        const side = event.target.value;
        if (side !== 'full' && side !== 'front' && side !== 'back' || !sourceTee) return;
        const tee = roundTee(sourceTee, side);
        if (!tee) return;
        changeRound({ ...round, roundSide: side, playerTeeSelections: (round.playerTeeSelections ?? []).filter((entry) => {
          const personal = profiles.find((profile) => profile.id === entry.teeProfileId);
          const selected = personal && roundTee(personal, side);
          return selected && compatibleTeeLayouts(tee, selected);
        }), groups: round.groups.map((group) => ({ ...group, startingHole: tee.holes.some((hole) => hole.number === group.startingHole)
          ? group.startingHole ?? 1 : tee.holes[0]?.number ?? 1 })) });
      }}>
        <option value="full">All holes (selected tee)</option>
        {(sourceTee?.holeCount === 18 || round.roundSide === 'front' || round.roundSide === 'back') && <>
          <option value="front">9 holes — Front (1–9)</option><option value="back">9 holes — Back (10–18)</option>
        </>}
      </select></label>
      {common && <p>{common.holeCount} holes · Par {common.totalPar} · {common.totalYardage.toLocaleString('en-US')} yards</p>}
      <QuickPlayerPicker players={players} selectedIds={draft.playerIds} disabled={disabled || locked} onToggle={togglePlayer} />
      {full && <label><input type="checkbox" checked={draft.allowPerGolferTees ?? false} onChange={(event) => {
        onChange({ ...draft, allowPerGolferTees: event.target.checked,
          rounds: [{ ...round, playerTeeSelections: event.target.checked ? round.playerTeeSelections ?? [] : [] }] });
      }} />Personal tees</label>}
      {error && <p role="alert">{error}</p>}
      {draft.playerIds.length > 0 && <h3>Playing groups</h3>}
      {round.groups.map((group) => <section key={group.number} className="quick-group" aria-label={`Group ${String(group.number)}`}>
        <div className="quick-section-heading"><div><h4>Group {group.number}</h4>
          <small>Starts hole {group.startingHole ?? common?.holes[0]?.number ?? 1}</small></div>
          <button type="button" aria-expanded={editingGroups.includes(group.number)} aria-label={`${editingGroups.includes(group.number) ? 'Done editing' : 'Edit'} Group ${String(group.number)}`}
            onClick={() => { setEditingGroups((values) => values.includes(group.number) ? values.filter((number) => number !== group.number) : [...values, group.number]); }}>
            {editingGroups.includes(group.number) ? 'Done' : 'Edit'}
          </button>
        </div>
        {!editingGroups.includes(group.number) ? <ul className="quick-group-summary">{group.playerIds.map((id) => <li key={id}>
          <span>{players.find((player) => player.id === id)?.displayName ?? 'Saved golfer'}</span>
          <CourseHandicap className="quick-handicap" value={handicapFor(id)} />
        </li>)}</ul> : <>
        <label>Group {group.number} starting hole<select value={group.startingHole ?? common?.holes[0]?.number ?? 1}
          onChange={(event) => { changeRound({ ...round, groups: round.groups.map((entry) => entry.number === group.number
            ? { ...entry, startingHole: Number(event.target.value) } : entry) }); }}>
          {(common?.holes ?? []).map((hole) => <option key={hole.number} value={hole.number}>{hole.number}</option>)}
        </select></label>
        <small>This start is shared by every game in this group. New Skins carryovers require the entire round to be one foursome.</small>
        {group.playerIds.map((id) => {
          const player = players.find((entry) => entry.id === id);
          const tee = playingProfiles.find((profile) => profile.id === round.playerTeeSelections?.find((entry) => entry.playerId === id)?.teeProfileId) ?? common;
          return <div key={id} className="quick-player">
            <p>{player?.displayName ?? 'Saved golfer'} · <CourseHandicap className="quick-handicap"
              value={handicapFor(id)} /></p>
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
        </>}
      </section>)}
    </fieldset>
  </>;
}
