import { useState } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  fakeCatalog, fictionalEntry, fictionalProfile, fictionalPlayers, fictionalSetup, fictionalVersion, fictionalWorkspace,
} from '../../client/catalog.test-support';
import type { CourseCatalogEntry, CourseVersion } from '../../domain/catalog';
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

describe('round setup editor', () => {
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
