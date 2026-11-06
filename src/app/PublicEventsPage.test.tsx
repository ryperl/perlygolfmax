import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PublicEventsPage } from './PublicEventsPage';
import { fakePublicServices, fictionalPublicWorkspace } from '../client/public-events.test-support';
import { PrivateRequestError } from '../client/private-request';
import type { EventPage } from '../domain/events';

beforeEach(() => { window.history.replaceState(null, '', '#events?choose=1'); });
describe('public directory date order', () => {
  it('withholds partial cards until every page arrives, then shows saved calendar dates in global order', async () => {
    const services = fakePublicServices();
    const event = fictionalPublicWorkspace.event;
    let finish: ((page: EventPage) => void) | undefined;
    vi.mocked(services.events.list).mockResolvedValueOnce({ events: [{ ...event, id: 'b', name: 'Fictional Later', startDate: '2026-11-02' }], continuationToken: 'next' })
      .mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    render(<PublicEventsPage services={services} />);
    await waitFor(() => { expect(finish).toBeDefined(); });
    expect(screen.queryByRole('heading', { name: 'Fictional Later' })).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('All pages must load');
    await act(async () => { finish?.({ events: [{ ...event, id: 'a', name: 'Fictional Earlier', startDate: '2024-02-29' }, { ...event, id: 'z', name: 'Fictional Undated' }] }); await Promise.resolve(); });
    const list = await screen.findByRole('list', { name: 'Active events' });
    expect(within(list).getAllByRole('heading').map((node) => node.textContent)).toEqual(['Fictional Earlier', 'Fictional Later', 'Fictional Undated']);
    expect(screen.getByText('February 29, 2024')).toHaveAttribute('datetime', '2024-02-29');
    expect(services.setup.load).not.toHaveBeenCalled();
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
