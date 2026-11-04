import { useState } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  fakeCatalog, fictionalEntry, fictionalId, fictionalProfile, fictionalPlayers, fictionalSetup, fictionalVersion, fictionalWorkspace,
} from '../../client/catalog.test-support';
import type { CourseCatalogEntry, CourseVersion } from '../../domain/catalog';
import type { RoundGroup, RoundSetupInput } from '../../domain/setup';
import { RoundEditor } from './RoundEditor';
import { roundInput } from './setup-draft';

const otherCourse: CourseCatalogEntry = {
  ...fictionalEntry, id: 'ghin:902:904', name: 'Fictional Links', location: 'Fictional Coast',
};

function renderEditor(courses: readonly CourseCatalogEntry[] = [fictionalEntry, otherCourse], version: CourseVersion = fictionalVersion) {
  const client = fakeCatalog();
  vi.mocked(client.version).mockResolvedValue(version);
  const changed = vi.fn();
  const pending = vi.fn();
  const saved = fictionalWorkspace.rounds[0];
  if (!saved) throw new Error('Missing fictional round.');
  const initial = roundInput(saved);
  function Fixture() {
    const [round, setRound] = useState(initial);
    return <RoundEditor round={round} saved={saved} number={1} courses={courses} players={fictionalPlayers}
      rosterIds={fictionalSetup.playerIds} client={client} onPending={pending} onChange={(value) => { changed(value); setRound(value); }} />;
  }
  render(<Fixture />);
  return { client, changed, pending };
}

const groupPlayers = Array.from({ length: 8 }, (_, index) => ({
  id: fictionalId(index + 1), displayName: `Fictional Player ${String(index + 1)}`,
  currentIndex: null, etag: 'player-v1', createdAt: '2026-01-01',
}));
function renderGroups(groups: readonly RoundGroup[]) {
  const original = fictionalSetup.rounds[0];
  if (!original) throw new Error('Missing fictional round.');
  const initial: RoundSetupInput = { ...original, groups };
  const client = fakeCatalog();
  const changed = vi.fn();
  const pending = vi.fn();
  function Fixture() {
    const [round, setRound] = useState(initial);
    return <RoundEditor round={round} saved={undefined} number={1} courses={[fictionalEntry]}
      players={groupPlayers} rosterIds={groupPlayers.map((player) => player.id)} client={client} onPending={pending}
      onChange={(value) => { changed(value); setRound(value); }} />;
  }
  render(<Fixture />);
  return changed;
}

describe('round setup editor', () => {
  it('disables a full group for additional players without disabling the selected group for its members', async () => {
    const changed = renderGroups([{ number: 1, playerIds: groupPlayers.slice(0, 4).map((player) => player.id) }]);
    const user = userEvent.setup();
    const fifth = screen.getByLabelText('Fictional Player 5 — round 1 group');
    expect(within(fifth).getByRole('option', { name: 'Group 1 (4/4, full)' })).toBeDisabled();
    expect(within(fifth).getByRole('option', { name: 'Group 2 (0/4)' })).toBeEnabled();
    expect(within(screen.getByLabelText('Fictional Player 1 — round 1 group'))
      .getByRole('option', { name: 'Group 1 (4/4, full)', selected: true })).toBeEnabled();
    for (const player of groupPlayers.slice(4)) {
      const field = screen.getByLabelText(`${player.displayName} — round 1 group`);
      await user.selectOptions(field, '1');
      expect(field).toHaveValue('');
    }
    expect(changed).not.toHaveBeenCalled();
    await user.selectOptions(fifth, '2');
    expect(fifth).toHaveValue('2');
    expect(within(fifth).getByRole('option', { name: 'Group 2 (1/4)', selected: true })).toBeEnabled();
  });

  it('rejects a stale change to a full group, preserves the original assignment and reopens places when someone moves out', async () => {
    const changed = renderGroups([
      { number: 1, playerIds: groupPlayers.slice(0, 4).map((player) => player.id) },
      { number: 2, playerIds: groupPlayers.slice(4).map((player) => player.id) },
    ]);
    const user = userEvent.setup();
    const eighth = screen.getByLabelText('Fictional Player 8 — round 1 group');
    fireEvent.change(eighth, { target: { value: '1' } });
    expect(screen.getByRole('alert')).toHaveTextContent('Group 1 is full. Choose a group with fewer than four players.');
    expect(eighth).toHaveValue('2');
    expect(changed).not.toHaveBeenCalled();
    await user.selectOptions(screen.getByLabelText('Fictional Player 4 — round 1 group'), '');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(within(eighth).getByRole('option', { name: 'Group 1 (3/4)' })).toBeEnabled();
    await user.selectOptions(eighth, '1');
    expect(eighth).toHaveValue('1');
    const first = screen.getByLabelText('Fictional Player 1 — round 1 group');
    expect(within(first).getByRole('option', { name: 'Group 2 (3/4)' })).toBeEnabled();
    await user.selectOptions(first, '2');
    expect(within(eighth).getByRole('option', { name: 'Group 2 (4/4, full)' })).toBeDisabled();
    expect(screen.getByLabelText('Fictional Player 2 — round 1 group')).toHaveValue('1');
    expect(screen.getByLabelText('Fictional Player 5 — round 1 group')).toHaveValue('2');
    expect(screen.getByLabelText('Fictional Player 4 — round 1 group')).toHaveValue('');
  });

  it('keeps an existing over-capacity draft visible for correction without silently removing golfers', async () => {
    const changed = renderGroups([
      { number: 1, playerIds: groupPlayers.slice(0, 5).map((player) => player.id) },
      { number: 2, playerIds: groupPlayers.slice(5).map((player) => player.id) },
    ]);
    expect(screen.getByText('Group 1 has 5 players; maximum four.')).toBeVisible();
    expect(changed).not.toHaveBeenCalled();
    const fifth = screen.getByLabelText('Fictional Player 5 — round 1 group');
    expect(within(fifth).getByRole('option', { name: 'Group 1 (5/4, full)', selected: true })).toBeEnabled();
    const user = userEvent.setup();
    await user.selectOptions(fifth, '2');
    expect(screen.queryByText('Group 1 has 5 players; maximum four.')).not.toBeInTheDocument();
    for (const player of groupPlayers) {
      const field = screen.getByLabelText(`${player.displayName} — round 1 group`);
      expect(within(field).getByRole('option', { selected: true })).toHaveTextContent('(4/4, full)');
    }
  });

  it('retains an explicit unsaved version when a catalog refresh publishes a different current version', async () => {
    const client = fakeCatalog();
    const round = fictionalSetup.rounds[0];
    if (!round) throw new Error('Missing fictional draft.');
    const props = {
      round, saved: undefined, number: 1, players: fictionalPlayers, rosterIds: fictionalSetup.playerIds,
      client, onPending: vi.fn(), onChange: vi.fn(),
    };
    const view = render(<RoundEditor {...props} courses={[fictionalEntry]} />);
    const version = screen.getByLabelText('Round 1 course version');
    await waitFor(() => { expect(screen.getByLabelText('Round 1 tee profile')).toBeEnabled(); });
    view.rerender(<RoundEditor {...props} courses={[{ ...fictionalEntry, currentVersionId: 'b'.repeat(64) }]} />);
    expect(version).toHaveValue(fictionalVersion.id);
    expect(within(version).getByRole('option', { name: 'Retained selected version', selected: true })).toBeInTheDocument();
    expect(within(version).getByRole('option', { name: 'Latest published version' })).toHaveValue('b'.repeat(64));
    expect(screen.getByLabelText('Round 1 tee profile')).toHaveValue('901');
    expect(client.version).toHaveBeenCalledTimes(1);
    expect(props.onChange).not.toHaveBeenCalled();
  });

  it('filters courses by name or location while keeping the selected course and explicit version', async () => {
    const { client, changed } = renderEditor();
    const user = userEvent.setup();
    const course = screen.getByLabelText('Round 1 course');
    const search = screen.getByRole('searchbox', { name: 'Find courses for round 1' });
    await user.type(search, 'COAST');
    expect(within(course).getByRole('option', { name: /Fictional Links/ })).toBeVisible();
    expect(within(course).getByRole('option', { name: /Fictional Meadows/ })).toBeVisible();
    expect(course).toHaveValue(fictionalVersion.courseId);
    await user.clear(search);
    await user.type(search, 'nothing matches');
    expect(within(course).getAllByRole('option')).toHaveLength(2);
    expect(screen.getByText('No courses match your search. Your selected course is retained.')).toBeVisible();
    expect(screen.getByLabelText('Round 1 course version')).toHaveValue(fictionalVersion.id);
    expect(changed).not.toHaveBeenCalled();
    expect(client.version).toHaveBeenCalledTimes(1);
  });

  it('shows only the selected tee summary, including its Total rating, without automatically selecting another profile', async () => {
    renderEditor();
    const user = userEvent.setup();
    const tee = screen.getByLabelText('Round 1 tee profile');
    await waitFor(() => { expect(within(tee).getAllByRole('option')).toHaveLength(3); });
    expect(tee).toHaveValue('901');
    expect(screen.getByText('9 holes · Par 36 · 900 yards · Rating 36 / Slope 100')).toBeVisible();
    await user.selectOptions(tee, '905');
    expect(tee).toHaveValue('905');
    expect(screen.getAllByText(/9 holes · Par/)).toHaveLength(1);
    await user.selectOptions(screen.getByLabelText('Round 1 course'), otherCourse.id);
    expect(screen.getByLabelText('Round 1 course version')).toHaveValue('');
    expect(tee).toHaveValue('');
    expect(screen.queryByText(/9 holes · Par/)).not.toBeInTheDocument();
  });

  it('keeps otherwise identical tee labels distinguishable and does not substitute Front ratings for missing Total', async () => {
    renderEditor([fictionalEntry], {
      ...fictionalVersion, data: { ...fictionalVersion.data, teeProfiles: [
        { ...fictionalProfile, ratings: [{ type: 'Front', course: 36.1, slope: 120, bogey: 45 }] },
        { ...fictionalProfile, id: 905 },
      ] },
    });
    const tee = screen.getByLabelText('Round 1 tee profile');
    await waitFor(() => { expect(within(tee).getAllByRole('option')).toHaveLength(3); });
    expect(within(tee).getByRole('option', { name: /profile 901/ })).toBeInTheDocument();
    expect(within(tee).getByRole('option', { name: /profile 905/ })).toBeInTheDocument();
    expect(screen.getByText(/Total rating unavailable/)).toBeVisible();
  });

  it('does not save a containing form when Enter is used in course search', async () => {
    const client = fakeCatalog();
    const saved = fictionalWorkspace.rounds[0];
    if (!saved) throw new Error('Missing fictional round.');
    const submitted = vi.fn();
    render(<form onSubmit={(event) => { event.preventDefault(); submitted(); }}>
      <RoundEditor round={roundInput(saved)} saved={saved} number={1} courses={[fictionalEntry]} players={fictionalPlayers}
        rosterIds={fictionalSetup.playerIds} client={client} onChange={vi.fn()} onPending={vi.fn()} />
      <button>Save</button>
    </form>);
    const user = userEvent.setup();
    await user.type(screen.getByRole('searchbox'), 'Fictional{Enter}');
    expect(submitted).not.toHaveBeenCalled();
  });
});
