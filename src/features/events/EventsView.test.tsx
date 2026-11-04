import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { EventsView } from './EventsView';
import type { EventsState } from './EventsView';

const actions = {
  onSignIn: vi.fn(), onSignOut: vi.fn(), onReload: vi.fn(), onNextPage: vi.fn(), onCreate: vi.fn().mockResolvedValue(false),
  view: 'active', onViewChange: vi.fn(), onStatusChange: vi.fn(),
} as const;
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
    render(<EventsView {...actions} state={{ kind: 'ready', page: { events: [] }, capabilities: { canCreateEvents: false, canManageCatalog: false } }} busy={false} notice="" />);
    expect(screen.getByText(/No events on this page/)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Create event' })).not.toBeInTheDocument();
  });
  it('renders authorized saved events and submits a bounded name only through its callback', async () => {
    const user = userEvent.setup();
    render(<EventsView {...actions} state={{
      kind: 'ready', page: { events: [{ id: 'fictional', name: 'Fictional Open', createdAt: '2026-01-01', role: 'owner', status: 'active', etag: 'fictional-v1' }] },
      capabilities: { canCreateEvents: true, canManageCatalog: false },
    }} busy={false} notice="" />);
    expect(screen.getByRole('heading', { name: 'Fictional Open' })).toBeVisible();
    const cardActions = screen.getByRole('group', { name: 'Actions for Fictional Open' });
    expect(cardActions).toHaveClass('event-card-actions');
    expect(within(cardActions).getByRole('link', { name: 'Open Fictional Open workspace' })).toHaveAttribute('href', '#events?event=fictional');
    expect(within(cardActions).getByRole('button', { name: 'Archive Fictional Open' })).toBeEnabled();
    await user.type(screen.getByLabelText('Event name'), 'Another fictional event');
    await user.click(screen.getByRole('button', { name: 'Create event' }));
    expect(actions.onCreate).toHaveBeenCalledWith('Another fictional event');
    expect(screen.getByLabelText('Event name')).toHaveValue('Another fictional event');
  });

  it('clears the submitted name only after the callback confirms a saved event', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn().mockResolvedValue(true);
    render(<EventsView {...actions} onCreate={onCreate} state={{
      kind: 'ready', page: { events: [] }, capabilities: { canCreateEvents: true, canManageCatalog: false },
    }} busy={false} notice="" />);
    const name = screen.getByLabelText('Event name');
    await user.type(name, 'Fictional Practice');
    await user.click(screen.getByRole('button', { name: 'Create event' }));
    expect(onCreate).toHaveBeenCalledWith('Fictional Practice');
    expect(name).toHaveValue('');
  });

  it('offers archive only for owners and restore only in the owner archived list', async () => {
    const user = userEvent.setup();
    const owned = { id: 'fictional', name: 'Fictional Open', createdAt: '2026-01-01', role: 'owner', status: 'active', etag: 'event-v1' } as const;
    const { rerender } = render(<EventsView {...actions} state={{
      kind: 'ready', page: { events: [owned, { ...owned, id: 'member', name: 'Member Trip', role: 'member' }] }, capabilities: { canCreateEvents: false, canManageCatalog: false },
    }} busy={false} notice="" />);
    await user.click(screen.getByRole('button', { name: 'Archive Fictional Open' }));
    expect(actions.onStatusChange).toHaveBeenCalledWith(owned, 'archived');
    expect(screen.queryByRole('button', { name: 'Archive Member Trip' })).not.toBeInTheDocument();
    const archived = { ...owned, status: 'archived' } as const;
    rerender(<EventsView {...actions} view="archived" state={{
      kind: 'ready', page: { events: [archived] }, capabilities: { canCreateEvents: true, canManageCatalog: false },
    }} busy={false} notice="" />);
    expect(screen.queryByLabelText('Event name')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Archived events' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: 'Restore Fictional Open' }));
    expect(actions.onStatusChange).toHaveBeenCalledWith(archived, 'active');
  });
});
