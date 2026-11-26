import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { RoundGameDefinition } from '../../domain/games';
import { roundGameKinds } from '../../domain/games';
import { ninesDotsContexts } from '../../domain/linked-dots';
import { ninesLinkedRound } from '../../domain/nines-linked.test-support';
import type { RoundScores } from '../../domain/scoring';
import { gameResult } from '../../client/scoring.test-support';
import { DotsHoleControls } from '../dots';
import { buildGame, newGameDraft } from './game-draft';
import { GameSettings } from './GameSettings';
import { RoundGamesPanel } from './index';
import type { RoundGamesPanelProps } from './index';
import { RoundGameHoleControls } from './RoundGameHoleControls';

/** New-game form for the group of three, with its Nines game already saved. */
function NewDotsForm({ save }: { readonly save: (game: RoundGameDefinition | null) => void }) {
  const { round, nines } = ninesLinkedRound();
  const [draft, change] = useState(() => newGameDraft(true));
  const ids = round.cards.map((card) => card.playerId);
  return <GameSettings draft={draft} roster={round.cards} groups={round.groups} supportedGameKinds={roundGameKinds}
    games={[nines]} ninesLinkedDotsSupported dotsIndividualPlayerCounts={[1, 2, 3, 4]} holeNumbers={[]}
    disabled={false} saveDisabled={false} cancelDisabled={false} retry={false}
    onChange={change} onSave={() => { save(buildGame(draft, ids)); }} onCancel={vi.fn()} />;
}

function renderPanel(round: RoundScores) {
  const onSave = vi.fn<RoundGamesPanelProps['onSave']>().mockImplementation(
    (games, etag, id) => Promise.resolve(gameResult(games, etag, id, round)));
  render(<RoundGamesPanel round={round} busy={false} onSave={onSave} onRefresh={vi.fn().mockResolvedValue(round)}
    onDirtyChange={vi.fn()} />);
  return { onSave };
}

function renderHoleControls(round: RoundScores) {
  const saved = round.cards[0]?.holes.find((hole) => hole.number === 1)?.score;
  if (!saved) throw new Error('Missing fictional hole');
  render(<RoundGameHoleControls round={round} groupNumber={1} holeNumber={1} saved={saved} disabled={false}
    onNassauChange={vi.fn()} onWolfChange={vi.fn()} onSpecialDotsChange={vi.fn()} />);
}

describe('Dots linked to Nines', () => {
  it('sets up a new Dots game linked to the Nines game through the form', async () => {
    const user = userEvent.setup();
    const save = vi.fn();
    const { nines } = ninesLinkedRound();
    render(<NewDotsForm save={save} />);
    await user.selectOptions(screen.getByLabelText('Game type'), 'dots');
    await user.selectOptions(screen.getByLabelText('Dots playing group'), '1');
    await user.selectOptions(screen.getByLabelText('Dots mode'), 'linked');
    await user.selectOptions(screen.getByLabelText('Linked game'), nines.id);
    await user.click(screen.getByRole('button', { name: 'Save game' }));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ kind: 'dots', mode: 'linked', linkedGameId: nines.id,
      groupNumber: 1, playerIds: nines.playerIds }));
  });

  it('labels the combined settlement as Nines + Dots, counted in points', () => {
    const { round } = ninesLinkedRound();
    renderPanel(round);
    const settlement = screen.getByRole('region', { name: /Fictional Nines \+ Fictional Dots internal settlement/u });
    expect(within(settlement).getAllByText(/^Nines \d+ \+ Dots \d+$/u)).toHaveLength(3);
    expect(within(settlement).getByText('Nines 54 + Dots 2')).toBeVisible();
    expect(within(settlement).getByText('56 points')).toBeVisible();
  });

  it('keeps the draft and explains when the API cannot save a Nines link', async () => {
    const user = userEvent.setup();
    const { round } = ninesLinkedRound(false);
    const { onSave } = renderPanel(round);
    await user.click(screen.getByRole('button', { name: /^Edit Fictional Dots/u }));
    await user.click(screen.getByRole('button', { name: 'Save game' }));
    await waitFor(() => { expect(screen.getByText(/Linking Dots to Nines is temporarily unavailable/u)).toBeVisible(); });
    expect(onSave).not.toHaveBeenCalled();
  });

  it('shows every Nines golfer playing alone in group score entry', () => {
    const { round } = ninesLinkedRound();
    renderHoleControls(round);
    expect(screen.getByText('Each golfer plays alone · Fictional golfer 1 · Fictional golfer 2 · Fictional golfer 3'))
      .toBeVisible();
  });

  it('locks Nines-linked specials when the API does not advertise the link', () => {
    const { round } = ninesLinkedRound(false);
    renderHoleControls(round);
    expect(screen.getByText('Dots linked to Nines edits are temporarily unavailable in this app version.')).toBeVisible();
    expect(screen.getByRole('group', { name: /Fictional Dots specials/u })).toBeDisabled();
  });

  it('tells a golfer they play alone instead of naming a partner', () => {
    const { round, dots, nines, a } = ninesLinkedRound();
    const context = ninesDotsContexts(nines, [1])[0];
    render(<DotsHoleControls game={dots} players={round.cards} playerId={a} holeNumber={1} par={4} etag="fictional"
      saved={undefined} draft={undefined} disabled={false} onChange={vi.fn()} context={context} contextLabel="Nines" />);
    expect(screen.getByText('Plays alone · Nines')).toBeVisible();
    expect(screen.queryByText(/Partner/u)).not.toBeInTheDocument();
  });
});
