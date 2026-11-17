import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { fictionalEvent } from '../../client/catalog.test-support';
import type { QuickRoundClient } from '../../client/quick-round';
import { EventChangedError } from '../../client/events';
import { QuickRoundArchive } from './QuickRoundArchive';

const event = { ...fictionalEvent, role: 'viewer' as const, quickRound: true as const };

describe('confirmed public Quick round archive', () => {
  it('requires confirmation, restores cancel focus and retains the same conditional request through an uncertain response', async () => {
    const archive = vi.fn<NonNullable<QuickRoundClient['archive']>>()
      .mockRejectedValueOnce(new Error('Fictional interrupted archive response')).mockResolvedValue(undefined);
    const done = vi.fn();
    const user = userEvent.setup();
    render(<QuickRoundArchive client={{ archive }} event={event} onArchived={done} onRefresh={vi.fn()} />);
    const trigger = screen.getByRole('button', { name: `Archive Quick round: ${event.name}` });
    await user.click(trigger);
    expect(screen.getByRole('heading', { name: `Archive ${event.name}?` })).toHaveFocus();
    expect(archive).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Cancel archive' }));
    expect(trigger).toHaveFocus();
    await user.click(trigger);
    await user.click(screen.getByRole('button', { name: 'Archive round' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Fictional interrupted');
    expect(done).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Close confirmation' }));
    await user.click(trigger);
    await user.click(screen.getByRole('button', { name: 'Retry archive' }));
    expect(done).toHaveBeenCalledOnce();
    expect(archive.mock.calls[0]?.slice(0, 3)).toEqual(archive.mock.calls[1]?.slice(0, 3));
    expect(archive.mock.calls[0]?.slice(0, 2)).toEqual([event.id, event.etag]);
  });

  it('requires explicit refresh after a revision conflict and never offers ordinary or unsupported archives', async () => {
    const archive = vi.fn<NonNullable<QuickRoundClient['archive']>>().mockRejectedValue(new EventChangedError('Round changed. Refresh first.'));
    const refresh = vi.fn(), done = vi.fn();
    const user = userEvent.setup();
    const view = render(<QuickRoundArchive client={{ archive }} event={event} onArchived={done} onRefresh={refresh} />);
    await user.click(screen.getByRole('button', { name: /^Archive Quick round:/ }));
    await user.click(screen.getByRole('button', { name: 'Archive round' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Round changed');
    expect(screen.getByRole('button', { name: 'Retry archive' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Refresh & review archive' }));
    expect(refresh).toHaveBeenCalledOnce();
    expect(done).not.toHaveBeenCalled();
    view.rerender(<QuickRoundArchive client={{ archive }} event={fictionalEvent} onArchived={done} onRefresh={refresh} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    view.rerender(<QuickRoundArchive client={{}} event={event} onArchived={done} onRefresh={refresh} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
