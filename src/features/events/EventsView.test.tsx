import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { EventsView } from './EventsView';
import type { EventsState } from './EventsView';

const actions = {
  onSignIn: vi.fn(), onSignOut: vi.fn(), onReload: vi.fn(), onNextPage: vi.fn(), onCreate: vi.fn(),
};
describe('EventsView', () => {
  it.each([
    { kind: 'unconfigured', message: 'No API configured' },
    { kind: 'loading' },
    { kind: 'error', message: 'Storage unavailable' },
  ] satisfies EventsState[])('shows honest %j state without a create form', (state) => {
    render(<EventsView {...actions} state={state} busy={false} notice="" />);
    expect(screen.queryByLabelText('Event name')).not.toBeInTheDocument();
    expect(screen.queryByText('Event saved.')).not.toBeInTheDocument();
    if (state.kind === 'error') expect(screen.getByRole('alert')).toHaveTextContent(state.message);
  });
  it('shows empty membership without treating it as invitation or creation authority', () => {
    render(<EventsView {...actions} state={{ kind: 'ready', page: { events: [] }, capabilities: { canCreateEvents: false } }} busy={false} notice="" />);
    expect(screen.getByText(/No events on this page/)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Create event' })).not.toBeInTheDocument();
  });
  it('renders authorized saved events and submits a bounded name only through its callback', async () => {
    const user = userEvent.setup();
    render(<EventsView {...actions} state={{
      kind: 'ready', page: { events: [{ id: 'fictional', name: 'Fictional Open', createdAt: '2026-01-01', role: 'owner' }] },
      capabilities: { canCreateEvents: true },
    }} busy={false} notice="" />);
    expect(screen.getByRole('heading', { name: 'Fictional Open' })).toBeVisible();
    await user.type(screen.getByLabelText('Event name'), 'Another fictional event');
    await user.click(screen.getByRole('button', { name: 'Create event' }));
    expect(actions.onCreate).toHaveBeenCalledWith('Another fictional event');
  });
});
