import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PublicEventsPage } from './PublicEventsPage';
import { fakePublicServices, fictionalPublicScores, fictionalPublicWorkspace } from '../client/public-events.test-support';
import { fictionalId } from '../client/catalog.test-support';
import type { RoundScores } from '../domain/scoring';
import { PrivateRequestError } from '../client/private-request';
import type { EventPage } from '../domain/events';
import { quickSource } from '../features/quick-round/quick-round.test-support';
import type { QuickRoundClient } from '../client/quick-round';

beforeEach(() => { window.history.replaceState(null, '', '#events?choose=1'); });
describe('public directory date order', () => {
  it('archives a Quick round only after confirmation and refreshes the directory without changing ordinary events', async () => {
    const base = fakePublicServices(), source = quickSource();
    const archive = vi.fn<NonNullable<QuickRoundClient['archive']>>().mockResolvedValue(undefined);
    const quick = { ...fictionalPublicWorkspace.event, quickRound: true as const };
    const normal = { ...fictionalPublicWorkspace.event, id: fictionalId(55), name: 'Fictional ordinary event' };
    vi.mocked(base.events.list).mockResolvedValueOnce({ events: [quick, normal] }).mockResolvedValueOnce({ events: [normal] });
    render(<PublicEventsPage services={{ ...base, quickRounds: { ...source.client, archive } }} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: `Archive Quick round: ${quick.name}` }));
    expect(archive).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Archive Quick round: Fictional ordinary event' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Archive round' }));
    await waitFor(() => { expect(screen.queryByRole('heading', { name: quick.name })).not.toBeInTheDocument(); });
    expect(await screen.findByRole('heading', { name: normal.name })).toBeVisible();
    expect(archive).toHaveBeenCalledWith(quick.id, quick.etag, expect.any(String), expect.any(AbortSignal));
    expect(base.events.list).toHaveBeenCalledTimes(2);
  });
  it('offers creation and edit only for the authoritative Quick round directory marker without workspace scans', async () => {
    const base = fakePublicServices();
    const source = quickSource();
    const services = { ...base, quickRounds: source.client };
    vi.mocked(services.events.list).mockResolvedValue({ events: [
      { ...fictionalPublicWorkspace.event, quickRound: true },
      { ...fictionalPublicWorkspace.event, id: fictionalId(55), name: 'Fictional ordinary event' },
    ] });
    render(<PublicEventsPage services={services} />);
    const create = await screen.findByRole('link', { name: 'New Quick round' });
    expect(create).toHaveAttribute('href', '#events?quick=1');
    expect(await screen.findByRole('link', { name: `Edit Quick round · ${fictionalPublicWorkspace.event.name}` }))
      .toHaveAttribute('href', `#events?event=${fictionalPublicWorkspace.event.id}&quick=1`);
    expect(screen.queryByRole('link', { name: 'Edit Quick round · Fictional ordinary event' })).not.toBeInTheDocument();
    expect(source.client.load).not.toHaveBeenCalled();
    expect(services.setup.load).not.toHaveBeenCalled();
    const user = userEvent.setup();
    await user.tab();
    expect(create).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Refresh events' })).toHaveFocus();
  });
  it('opens Quick setup before ordinary event details and keeps older services explicit', async () => {
    window.history.replaceState(null, '', '#events?quick=1');
    const services = fakePublicServices();
    const view = render(<PublicEventsPage services={services} />);
    expect(screen.getByRole('heading', { name: 'Quick rounds unavailable' })).toBeVisible();
    const source = quickSource();
    view.rerender(<PublicEventsPage services={{ ...services, quickRounds: source.client }} />);
    expect(await screen.findByRole('heading', { name: 'Play a Quick round' })).toBeVisible();
    expect(services.setup.load).not.toHaveBeenCalled();
  });
  it('withholds partial cards until every page arrives, then shows saved calendar dates in global order', async () => {
    const services = fakePublicServices();
    const event = fictionalPublicWorkspace.event;
    let finish: ((page: EventPage) => void) | undefined;
    vi.mocked(services.events.list).mockResolvedValueOnce({ events: [{ ...event, id: 'b', name: 'Fictional Later', startDate: '2026-11-02' }], continuationToken: 'next' })
      .mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    render(<PublicEventsPage services={services} />);
    await waitFor(() => { expect(finish).toBeDefined(); });
    expect(screen.queryByRole('heading', { name: 'Fictional Later' })).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Loading events');
    await act(async () => { finish?.({ events: [{ ...event, id: 'a', name: 'Fictional Earlier', startDate: '2024-02-29' }, { ...event, id: 'z', name: 'Fictional Undated' }] }); await Promise.resolve(); });
    const list = await screen.findByRole('list', { name: 'Active events' });
    expect(within(list).getAllByRole('heading').map((node) => node.textContent)).toEqual(['Fictional Earlier', 'Fictional Later', 'Fictional Undated']);
    expect(screen.getByText('February 29, 2024')).toHaveAttribute('datetime', '2024-02-29');
    expect(services.setup.load).not.toHaveBeenCalled();
  });

  describe('public round navigation', () => {
    it('keeps the styled Round picker and tools visible and blocks switching during loads and drafts', async () => {
      const services = fakePublicServices();
      const first = fictionalPublicWorkspace.rounds[0];
      if (!first) throw new Error('Missing fictional round.');
      const second = { ...first, id: fictionalId(71), name: 'Fictional next round' };
      vi.mocked(services.setup.load).mockResolvedValue({ ...fictionalPublicWorkspace, rounds: [first, second] });
      let finish: ((scores: RoundScores) => void) | undefined;
      vi.mocked(services.scores.load).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }))
        .mockImplementation((_event, roundId) => Promise.resolve({ ...fictionalPublicScores, roundId,
          roundName: roundId === second.id ? second.name : first.name }));
      window.history.replaceState(null, '', `#events?event=${fictionalPublicWorkspace.event.id}&round=${first.id}`);
      render(<PublicEventsPage services={services} />);
      const picker = await screen.findByRole('combobox', { name: 'Round' });
      await waitFor(() => { expect(finish).toBeDefined(); });
      expect(picker).toBeDisabled();
      expect(picker.closest('details')).toBeNull();
      expect(picker.closest('.score-round-picker')).not.toBeNull();
      const firstTone = picker.closest('[data-round-tone]')?.getAttribute('data-round-tone');
      expect(firstTone).toBeTruthy();
      await act(async () => { finish?.(fictionalPublicScores); await Promise.resolve(); });
      await waitFor(() => { expect(picker).toBeEnabled(); });
      expect(screen.queryByText('Round details & tools')).not.toBeInTheDocument();
      for (const name of ['Scorecards', 'Enter scores', 'Games', 'Leaderboard']) {
        expect(screen.getByRole('button', { name })).toBeVisible();
      }
      expect(picker).toBeVisible();
      expect(screen.queryByText(/Online only|Finish setup first|Enter scores for any saved playing group|Reopening restores|Saved scores loaded|Auto-checks while visible|Ready for scores/))
        .not.toBeInTheDocument();
      const user = userEvent.setup();
      await user.type(screen.getByRole('textbox', { name: 'Fictional Player 1 score' }), '6');
      expect(picker).toBeDisabled();
      const location = window.location.hash;
      fireEvent.change(picker, { target: { value: second.id } });
      expect(window.location.hash).toBe(location);
      await user.click(screen.getByRole('button', { name: 'Discard unsaved scores' }));
      expect(picker).toBeEnabled();
      await user.selectOptions(picker, second.id);
      await waitFor(() => { expect(services.scores.load).toHaveBeenLastCalledWith(fictionalPublicWorkspace.event.id, second.id, expect.any(AbortSignal)); });
      expect(await screen.findByRole('combobox', { name: 'Round' })).toHaveValue(second.id);
      expect(screen.getByRole('combobox', { name: 'Round' }).closest('[data-round-tone]')?.getAttribute('data-round-tone')).not.toBe(firstTone);
      expect(services.scores.save).not.toHaveBeenCalled();
      expect(services.scores.saveGames).not.toHaveBeenCalled();
    });
  });
  it('shows an incomplete quota failure, retains staged pages on retry, and offers explicit fresh reload', async () => {
    const services = fakePublicServices();
    vi.mocked(services.events.list).mockResolvedValueOnce({ events: [fictionalPublicWorkspace.event], continuationToken: 'next' })
      .mockRejectedValueOnce(new PrivateRequestError(429, 'Fictional quota', 1))
      .mockResolvedValueOnce({ events: [] });
    render(<PublicEventsPage services={services} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Wait 1 seconds');
    expect(screen.queryByRole('list', { name: 'Active events' })).not.toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByRole('heading', { name: fictionalPublicWorkspace.event.name });
    expect(services.events.list).toHaveBeenLastCalledWith(expect.any(AbortSignal), 'next', 'active');
    await user.click(screen.getByRole('button', { name: 'Refresh events' }));
    await waitFor(() => { expect(services.events.list).toHaveBeenLastCalledWith(expect.any(AbortSignal), undefined, 'active'); });
  });
});
