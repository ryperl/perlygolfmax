import { useEffect, useState } from 'react';
import type { CatalogClient } from '../../client/catalog';
import { SessionExpiredError } from '../../client/events';
import { PrivateRequestError } from '../../client/private-request';
import type { CourseCatalogEntry, CourseVersion, PlayerProfile, TeeProfile } from '../../domain/catalog';
import type { RoundSetupInput, RoundSnapshot } from '../../domain/setup';
import { compatibleTeeLayouts } from '../../domain/tees';
import { SetupPager } from './SetupPager';

const groupCapacity = 4;

export function RoundEditor({ round, number, saved, courses, players, rosterIds, client, onChange, onPending, allowPerGolferTees = false, onDenied }: {
  readonly round: RoundSetupInput;
  readonly number: number;
  readonly saved: RoundSnapshot | undefined;
  readonly courses: readonly CourseCatalogEntry[];
  readonly players: readonly PlayerProfile[];
  readonly rosterIds: readonly string[];
  readonly client: CatalogClient;
  readonly onChange: (round: RoundSetupInput) => void;
  readonly onPending: (id: string, pending: boolean) => void;
  readonly allowPerGolferTees?: boolean;
  readonly onDenied?: (failure: Error, expired: boolean) => void;
}) {
  const [loaded, setLoaded] = useState<CourseVersion | null>(null);
  const [failure, setFailure] = useState<{ readonly courseId: string; readonly versionId: string; readonly message: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState('');
  const [assignmentError, setAssignmentError] = useState('');
  const [teeNotice, setTeeNotice] = useState('');
  const [playerQuery, setPlayerQuery] = useState('');
  const [playerPage, setPlayerPage] = useState(0);
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
      if (!controller.signal.aborted && (failure instanceof SessionExpiredError
        || failure instanceof PrivateRequestError && [401, 403, 404].includes(failure.status))) {
        setLoaded(null);
        onDenied?.(failure, failure instanceof SessionExpiredError || failure.status === 401);
      }
      if (!controller.signal.aborted) setFailure({
        courseId: round.courseId, versionId, message: failure instanceof Error ? failure.message : 'Could not load the selected version.',
      });
    }).finally(() => { if (!controller.signal.aborted) onPending(round.id, false); });
    return () => { controller.abort(); onPending(round.id, false); };
  }, [attempt, client, onDenied, onPending, round.courseId, round.id, versionId]);
  const profiles: readonly TeeProfile[] = loaded?.id === versionId && loaded.courseId === round.courseId ? loaded.data.teeProfiles
    : savedMatches ? [saved.teeProfile, ...(saved.playerTees ?? []).map((entry) => entry.profile)]
      .filter((profile, index, list) => list.findIndex((other) => other.id === profile.id) === index) : [];
  const error = failure?.courseId === round.courseId && failure.versionId === versionId ? failure.message : '';
  const term = query.trim().toLowerCase();
  const matches = courses.filter((course) => `${course.name} ${course.location}`.toLowerCase().includes(term));
  const choices = courses.filter((course) => course.id === round.courseId || matches.includes(course));
  const tee = profiles.find((profile) => profile.id === round.teeProfileId);
  const totalRating = tee?.ratings.find((rating) => rating.type === 'Total');
  const unassigned = rosterIds.filter((id) => !round.groups.some((group) => group.playerIds.includes(id)));
  const groupNumbers = new Set(round.groups.map((group) => group.number));
  let nextGroup = 1;
  while (groupNumbers.has(nextGroup)) nextGroup++;
  const groupChoices = [...groupNumbers, nextGroup].sort((a, b) => a - b);
  const visiblePlayers = rosterIds.filter((id) => (players.find((player) => player.id === id)?.displayName ?? 'Saved player')
    .toLowerCase().includes(playerQuery.trim().toLowerCase()));
  const pageSize = 12;
  const page = Math.min(playerPage, Math.max(0, Math.ceil(visiblePlayers.length / pageSize) - 1));
  const pagePlayers = visiblePlayers.slice(page * pageSize, (page + 1) * pageSize);
  function clearCourseSelection(courseId: string, courseVersionId: string) {
    if (round.playerTeeSelections?.length) setTeeNotice('Personal tee selections cleared because the course or version changed. Assign tees from the selected version again.');
    onChange({ ...round, courseId, courseVersionId, teeProfileId: 0, playerTeeSelections: [] });
  }
  return <section>
    <label>Find round golfers<input type="search" value={playerQuery} onChange={(event) => {
      setPlayerQuery(event.target.value); setPlayerPage(0);
    }} onKeyDown={(event) => { if (event.key === 'Enter') event.preventDefault(); }} /></label>
    <SetupPager page={page} count={visiblePlayers.length} size={pageSize} label="round golfers" onChange={setPlayerPage} />
    <fieldset className="setup-round" disabled={saved?.scoringStarted === true}>
    <legend>Round {number}{saved ? ' (saved; retained)' : ''}</legend>
    {saved?.scoringStarted && <p>Locked after scoring. Saved course, tee, players and groups cannot be changed.</p>}
    <label>Round {number} name<input required maxLength={100} value={round.name} onChange={(event) => { onChange({ ...round, name: event.target.value }); }} /></label>
    <label>Find courses for round {number}<input type="search" value={query} onChange={(event) => { setQuery(event.target.value); }}
      onKeyDown={(event) => { if (event.key === 'Enter') event.preventDefault(); }} /></label>
    {term && matches.length === 0 && <p>No courses match your search. Your selected course is retained.</p>}
    <label>Round {number} course<select required value={round.courseId} onChange={(event) => {
      clearCourseSelection(event.target.value, '');
    }}><option value="">Choose a saved course</option>
      {saved && !courses.some((course) => course.id === saved.courseId) && <option value={saved.courseId}>{saved.course.name} (saved course)</option>}
      {choices.map((course) => <option value={course.id} key={course.id}>{course.name} — {course.location}</option>)}
    </select></label>
    <label>Round {number} course version<select required value={versionId} disabled={!round.courseId} onChange={(event) => {
      clearCourseSelection(round.courseId, event.target.value);
    }}><option value="">Choose an explicit version</option>
      {saved?.courseId === round.courseId && saved.courseVersionId !== current?.currentVersionId && <option value={saved.courseVersionId}>Saved captured version</option>}
      {versionId !== '' && versionId !== current?.currentVersionId
        && !(saved?.courseId === round.courseId && saved.courseVersionId === versionId)
        && <option value={versionId}>Retained selected version</option>}
      {current && <option value={current.currentVersionId}>{savedMatches && saved.courseVersionId === current.currentVersionId ? 'Saved captured version (latest published)' : 'Latest published version'}</option>}
    </select></label>
    <label>Round {number} tee profile<select required value={round.teeProfileId || ''} disabled={profiles.length === 0} onChange={(event) => {
      const selected = profiles.find((profile) => profile.id === Number(event.target.value));
      const retained = (round.playerTeeSelections ?? []).filter((entry) => {
        const personal = profiles.find((profile) => profile.id === entry.teeProfileId);
        return selected && personal && selected.id !== personal.id && compatibleTeeLayouts(selected, personal);
      });
      if (retained.length !== (round.playerTeeSelections?.length ?? 0)) setTeeNotice('Personal tee selections that no longer differ from, or are incompatible with, the default tee were cleared. Review golfer tees before saving.');
      onChange({ ...round, teeProfileId: Number(event.target.value), playerTeeSelections: retained });
    }}><option value="">Choose a tee and category</option>{profiles.map((profile, index) => <option key={profile.id} value={profile.id}>
      {profile.name} / {profile.category} / {profile.holeCount} holes
      {profiles.some((other) => other.id !== profile.id && other.name === profile.name && other.category === profile.category
        && other.holeCount === profile.holeCount) ? ` / ${profile.totalYardage.toLocaleString('en-US')} yards / par ${String(profile.totalPar)} / choice ${String(index + 1)}` : ''}
    </option>)}</select></label>
    {tee && <p className="setup-tee-summary">{tee.holeCount} holes · Par {tee.totalPar} · {tee.totalYardage.toLocaleString('en-US')} yards
      {totalRating ? ` · Rating ${String(totalRating.course)} / Slope ${String(totalRating.slope)}` : ' · Total rating unavailable'}
    </p>}
    {error && <div><p role="alert">{error} No new tee was selected.</p>
      <button type="button" onClick={() => { setAttempt((previous) => previous + 1); }}>Retry round {number} version</button>
    </div>}
    {teeNotice && <p role="status">{teeNotice}</p>}
    <p>{rosterIds.length} {rosterIds.length === 1 ? 'golfer' : 'golfers'} · {round.groups.length} playing {round.groups.length === 1 ? 'group' : 'groups'} · {rosterIds.length - unassigned.length} assigned. Search and paging retain all selections.</p>
    {visiblePlayers.length === 0 && rosterIds.length > 0 && <p>No golfers match your search. Existing assignments are retained.</p>}
    {allowPerGolferTees && <fieldset><legend>Personal tees · round {number}</legend>
      <p>The organizer assigns tees separately for each round. The common tee is the default. Only tees with matching hole numbers and hole count are available.</p>
      {!tee && <p>Choose the default tee before assigning personal tees.</p>}
      {pagePlayers.map((id) => {
        const selection = round.playerTeeSelections?.find((entry) => entry.playerId === id);
        const selected = profiles.find((profile) => profile.id === selection?.teeProfileId);
        const compatible = tee ? profiles.filter((profile) => profile.id !== tee.id && compatibleTeeLayouts(tee, profile)) : [];
        return <label key={id}>{players.find((player) => player.id === id)?.displayName ?? 'Saved player'} — round {number} tee
          <select value={selection?.teeProfileId ?? ''} disabled={!tee || error !== ''} onChange={(event) => {
            const others = (round.playerTeeSelections ?? []).filter((entry) => entry.playerId !== id);
            onChange({ ...round, playerTeeSelections: event.target.value === '' ? others
              : [...others, { playerId: id, teeProfileId: Number(event.target.value) }] });
          }}>
            <option value="">Default{tee ? ` — ${tee.name} / ${tee.category}` : ''}</option>
            {selection && !compatible.some((profile) => profile.id === selection.teeProfileId)
              && <option value={selection.teeProfileId}>{selected ? `${selected.name} / ${selected.category}` : 'Retained tee unavailable'} — review required</option>}
            {compatible.map((profile) => <option key={profile.id} value={profile.id}>{profile.name} / {profile.category} / {profile.holeCount} holes / {profile.totalYardage.toLocaleString('en-US')} yards / Par {profile.totalPar}</option>)}
          </select>
        </label>;
      })}
    </fieldset>}
    <fieldset><legend>Playing groups</legend>
      <p>Assign every selected player once, up to four per group. Playing groups are not competition teams.</p>
      {assignmentError && <p role="alert">{assignmentError}</p>}
      {rosterIds.length === 0 && <p>Select the event players first.</p>}
      {unassigned.length > 0 && <p>{unassigned.length} {unassigned.length === 1 ? 'player needs' : 'players need'} a group.</p>}
      {round.groups.filter((group) => group.playerIds.length > groupCapacity).map((group) => <p key={group.number}>
        Group {group.number} has {group.playerIds.length} players; maximum four.
      </p>)}
      {pagePlayers.map((id) => <label key={id}>{players.find((player) => player.id === id)?.displayName ?? 'Saved player'} — round {number} group
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
        }}><option value="">Assign manually</option>{groupChoices.map((number) => {
          const members = round.groups.find((group) => group.number === number)?.playerIds ?? [];
          const full = members.length >= groupCapacity;
          return <option key={number} value={number} disabled={full && !members.includes(id)}>
            {groupNumbers.has(number) ? `Group ${String(number)} (${String(members.length)}/${String(groupCapacity)}${full ? ', full' : ''})` : `Create Group ${String(number)}`}
          </option>;
        })}</select>
      </label>)}
    </fieldset>
  </fieldset></section>;
}
