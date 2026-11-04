import { useEffect, useState } from 'react';
import type { CatalogClient } from '../../client/catalog';
import type { CourseCatalogEntry, CourseVersion, PlayerProfile, TeeProfile } from '../../domain/catalog';
import type { RoundSetupInput, RoundSnapshot } from '../../domain/setup';

const groupCapacity = 4;

export function RoundEditor({ round, number, saved, courses, players, rosterIds, client, onChange, onPending }: {
  readonly round: RoundSetupInput;
  readonly number: number;
  readonly saved: RoundSnapshot | undefined;
  readonly courses: readonly CourseCatalogEntry[];
  readonly players: readonly PlayerProfile[];
  readonly rosterIds: readonly string[];
  readonly client: CatalogClient;
  readonly onChange: (round: RoundSetupInput) => void;
  readonly onPending: (id: string, pending: boolean) => void;
}) {
  const [loaded, setLoaded] = useState<CourseVersion | null>(null);
  const [failure, setFailure] = useState<{ readonly courseId: string; readonly versionId: string; readonly message: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState('');
  const [assignmentError, setAssignmentError] = useState('');
  const current = courses.find((course) => course.id === round.courseId);
  const savedMatches = saved?.courseId === round.courseId && saved.courseVersionId === round.courseVersionId;
  const versionId = round.courseVersionId;
  useEffect(() => {
    if (!versionId) return;
    const controller = new AbortController();
    onPending(round.id, true);
    void client.version(round.courseId, versionId, controller.signal).then((value) => {
      if (!controller.signal.aborted) { setLoaded(value); setFailure(null); }
    }).catch((failure: unknown) => {
      if (!controller.signal.aborted) setFailure({
        courseId: round.courseId, versionId, message: failure instanceof Error ? failure.message : 'Could not load the selected version.',
      });
    }).finally(() => { if (!controller.signal.aborted) onPending(round.id, false); });
    return () => { controller.abort(); onPending(round.id, false); };
  }, [attempt, client, onPending, round.courseId, round.id, versionId]);
  const profiles: readonly TeeProfile[] = loaded?.id === versionId && loaded.courseId === round.courseId ? loaded.data.teeProfiles
    : savedMatches ? [saved.teeProfile] : [];
  const error = failure?.courseId === round.courseId && failure.versionId === versionId ? failure.message : '';
  const term = query.trim().toLowerCase();
  const matches = courses.filter((course) => `${course.name} ${course.location}`.toLowerCase().includes(term));
  const choices = courses.filter((course) => course.id === round.courseId || matches.includes(course));
  const tee = profiles.find((profile) => profile.id === round.teeProfileId);
  const totalRating = tee?.ratings.find((rating) => rating.type === 'Total');
  const unassigned = rosterIds.filter((id) => !round.groups.some((group) => group.playerIds.includes(id)));
  return <fieldset className="setup-round" disabled={saved?.scoringStarted === true}>
    <legend>Round {number}{saved ? ' (saved; retained)' : ''}</legend>
    {saved?.scoringStarted && <p>Locked after scoring. Saved course, tee, players and groups cannot be changed.</p>}
    <label>Round {number} name<input required maxLength={100} value={round.name} onChange={(event) => { onChange({ ...round, name: event.target.value }); }} /></label>
    <label>Find courses for round {number}<input type="search" value={query} onChange={(event) => { setQuery(event.target.value); }}
      onKeyDown={(event) => { if (event.key === 'Enter') event.preventDefault(); }} /></label>
    {term && matches.length === 0 && <p>No courses match your search. Your selected course is retained.</p>}
    <label>Round {number} course<select required value={round.courseId} onChange={(event) => {
      onChange({ ...round, courseId: event.target.value, courseVersionId: '', teeProfileId: 0 });
    }}><option value="">Choose a saved course</option>
      {saved && !courses.some((course) => course.id === saved.courseId) && <option value={saved.courseId}>{saved.course.name} (saved course)</option>}
      {choices.map((course) => <option value={course.id} key={course.id}>{course.name} — {course.location}</option>)}
    </select></label>
    <label>Round {number} course version<select required value={versionId} disabled={!round.courseId} onChange={(event) => {
      onChange({ ...round, courseVersionId: event.target.value, teeProfileId: 0 });
    }}><option value="">Choose an explicit version</option>
      {saved?.courseId === round.courseId && saved.courseVersionId !== current?.currentVersionId && <option value={saved.courseVersionId}>Saved captured version</option>}
      {versionId !== '' && versionId !== current?.currentVersionId
        && !(saved?.courseId === round.courseId && saved.courseVersionId === versionId)
        && <option value={versionId}>Retained selected version</option>}
      {current && <option value={current.currentVersionId}>{savedMatches && saved.courseVersionId === current.currentVersionId ? 'Saved captured version (latest published)' : 'Latest published version'}</option>}
    </select></label>
    <label>Round {number} tee profile<select required value={round.teeProfileId || ''} disabled={profiles.length === 0} onChange={(event) => {
      onChange({ ...round, teeProfileId: Number(event.target.value) });
    }}><option value="">Choose a tee and category</option>{profiles.map((profile) => <option key={profile.id} value={profile.id}>
      {profile.name} / {profile.category} / {profile.holeCount} holes
      {profiles.some((other) => other.id !== profile.id && other.name === profile.name && other.category === profile.category
        && other.holeCount === profile.holeCount) ? ` / profile ${String(profile.id)}` : ''}
    </option>)}</select></label>
    {tee && <p className="setup-tee-summary">{tee.holeCount} holes · Par {tee.totalPar} · {tee.totalYardage.toLocaleString('en-US')} yards
      {totalRating ? ` · Rating ${String(totalRating.course)} / Slope ${String(totalRating.slope)}` : ' · Total rating unavailable'}
    </p>}
    {error && <div><p role="alert">{error} No new tee was selected.</p>
      <button type="button" onClick={() => { setAttempt((previous) => previous + 1); }}>Retry round {number} version</button>
    </div>}
    <fieldset><legend>Playing groups</legend>
      <p>Assign every selected player once, up to four per group. Playing groups are not competition teams.</p>
      {assignmentError && <p role="alert">{assignmentError}</p>}
      {rosterIds.length === 0 && <p>Select the event players first.</p>}
      {unassigned.length > 0 && <p>{unassigned.length} {unassigned.length === 1 ? 'player needs' : 'players need'} a group.</p>}
      {round.groups.filter((group) => group.playerIds.length > groupCapacity).map((group) => <p key={group.number}>
        Group {group.number} has {group.playerIds.length} players; maximum four.
      </p>)}
      {rosterIds.map((id) => <label key={id}>{players.find((player) => player.id === id)?.displayName ?? 'Saved player'} — round {number} group
        <select required value={round.groups.find((group) => group.playerIds.includes(id))?.number ?? ''} onChange={(event) => {
          const number = Number(event.target.value);
          const target = round.groups.find((group) => group.number === number);
          if (target && target.playerIds.length >= groupCapacity && !target.playerIds.includes(id)) {
            setAssignmentError(`Group ${String(number)} is full. Choose a group with fewer than four players.`);
            return;
          }
          setAssignmentError('');
          const groups = round.groups.map((group) => ({ ...group, playerIds: group.playerIds.filter((playerId) => playerId !== id) })).filter((group) => group.playerIds.length > 0);
          if (number) {
            const existing = groups.find((group) => group.number === number);
            if (existing) onChange({ ...round, groups: groups.map((group) => group.number === number ? { ...group, playerIds: [...group.playerIds, id] } : group) });
            else onChange({ ...round, groups: [...groups, { number, playerIds: [id] }] });
          } else onChange({ ...round, groups });
        }}><option value="">Assign manually</option>{[1, 2, 3, 4].map((number) => {
          const members = round.groups.find((group) => group.number === number)?.playerIds ?? [];
          const full = members.length >= groupCapacity;
          return <option key={number} value={number} disabled={full && !members.includes(id)}>
            Group {number} ({members.length}/{groupCapacity}{full ? ', full' : ''})
          </option>;
        })}</select>
      </label>)}
    </fieldset>
  </fieldset>;
}
