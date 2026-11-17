import { useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { fictionalId, fictionalPlayers, fictionalProfile, fictionalSetup } from '../../client/catalog.test-support';
import { QuickSetupFields } from './QuickSetupFields';

function Fixture() {
  const [draft, setDraft] = useState({ ...fictionalSetup, allowPerGolferTees: true });
  return <QuickSetupFields draft={draft} courses={[]} players={[
    ...fictionalPlayers.map((player, index) => ({ id: player.id, displayName: player.displayName,
      ...(index === 2 ? {} : { handicapIndexValue: index === 0 ? '+4.0' : index === 3 ? 'invalid' : '0' }) })),
    { id: fictionalId(5), displayName: 'Fictional fifth golfer', handicapIndexValue: null },
  ]} profiles={[fictionalProfile, { ...fictionalProfile, id: 905, name: 'Fictional incompatible', holes: [], holeCount: 18 }]}
    full locked={false} disabled={false} onChange={(value) => { setDraft({ ...value, allowPerGolferTees: value.allowPerGolferTees ?? false }); }} />;
}

describe('Quick round setup selections', () => {
  it('sorts golfer choices by surname before paging without changing assignment identities', () => {
    const players = Array.from({ length: 13 }, (_, index) => ({
      id: fictionalId(index + 1), displayName: index === 12 ? 'Zoe Adams' : `Fictional Zulu${String(index).padStart(2, '0')}`,
      handicapIndexValue: null,
    }));
    const changed = vi.fn();
    render(<QuickSetupFields draft={{ ...fictionalSetup, playerIds: [], rounds: fictionalSetup.rounds.map((round) => ({ ...round, groups: [] })) }}
      courses={[]} players={players} profiles={[fictionalProfile]} full={false} locked={false} disabled={false} onChange={changed} />);
    expect(screen.getAllByRole('checkbox')[0]).toHaveAccessibleName('Zoe Adams');
    fireEvent.click(screen.getByLabelText('Zoe Adams'));
    expect(changed).toHaveBeenLastCalledWith(expect.objectContaining({ playerIds: [fictionalId(13)] }));
    fireEvent.click(screen.getByRole('button', { name: 'Next golfers' }));
    expect(screen.getAllByRole('checkbox')).toHaveLength(1);
    expect(screen.getByRole('checkbox')).toHaveAccessibleName('Fictional Zulu11');
  });
  it('retains selected golfers through search and refuses overfull groups without losing assignments', () => {
    render(<Fixture />);
    fireEvent.click(screen.getByLabelText('Fictional fifth golfer', { exact: true }));
    fireEvent.change(screen.getByLabelText('Fictional fifth golfer group'), { target: { value: '1' } });
    expect(screen.getByRole('alert')).toHaveTextContent('at most four');
    expect(screen.getByLabelText('Fictional fifth golfer group')).toHaveValue('2');
    const first = screen.getByRole('region', { name: 'Group 1' });
    expect(within(first).getAllByRole('button', { name: /Remove/ })).toHaveLength(4);
    fireEvent.change(screen.getByLabelText('Find saved golfers'), { target: { value: 'fifth' } });
    expect(screen.queryByLabelText('Fictional Player 1', { exact: true })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Fictional Player 1 group')).toHaveValue('1');
    fireEvent.change(screen.getByLabelText('Find saved golfers'), { target: { value: '' } });
    expect(screen.getByLabelText('Fictional Player 1', { exact: true })).toBeChecked();
    expect(screen.getByLabelText('Course handicap: +2')).toHaveTextContent('CH +2');
    expect(screen.getByLabelText('Course handicap: 0')).toHaveTextContent('CH 0');
    expect(screen.getByLabelText('No captured Handicap Index')).toHaveTextContent('NH');
    expect(screen.getAllByLabelText('Course handicap unavailable')).toHaveLength(2);
    expect(within(screen.getByLabelText('Fictional Player 1 tee')).queryByRole('option', { name: /incompatible/ })).not.toBeInTheDocument();
  });
});
