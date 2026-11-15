import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EventSkinsSettings } from './index';
import type { EventLeaderboardClient } from '../../client/event-leaderboard';
import type { EventSkinsChange } from '../../domain/event-skins';
import { eventSkinsFixture, withoutEventSkins } from '../../domain/event-skins.test-support';
import { purseTestId } from '../../domain/purse.test-support';

function fixture() {
  const workspace = { ...withoutEventSkins(eventSkinsFixture().workspace), eventSkinsSupported: true as const };
  const configure = vi.fn<NonNullable<EventLeaderboardClient['configureEventSkins']>>(async (eventId, after, expectedEtag, id) =>
    Promise.resolve({ id, eventId, expectedEtag, before: null, after, recordedAt: '2026-01-01T00:00:00Z',
      recordedBy: { tenantId: purseTestId(7001), objectId: purseTestId(7002) } }));
  return { workspace, configure, onSaved: vi.fn() };
}
describe('event skins owner configuration', () => {
  it('requires explicit enablement, conditionally saves only this competition and never assumes a money amount', async () => {
    const props = fixture();
    render(<EventSkinsSettings {...props} />);
    expect(screen.getByRole('button', { name: 'Save event skins settings' })).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Enable event-wide net skins' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save event skins settings' }));
    await waitFor(() => { expect(props.onSaved).toHaveBeenCalledOnce(); });
    expect(props.configure.mock.calls[0]?.slice(0, 3)).toEqual([props.workspace.event.id, { version: 1 }, props.workspace.etag]);
    expect(props.configure.mock.calls[0]?.[3]).toMatch(/^[a-f0-9-]{36}$/);
    expect(screen.queryByText(/100\.00/)).not.toBeInTheDocument();
  });
  it('retains the request identity and conditional base after an uncertain failure and refuses an unrelated acknowledgement', async () => {
    const props = fixture();
    props.configure.mockRejectedValueOnce(new Error('Connection interrupted'));
    props.configure.mockImplementationOnce(async (eventId, after, expectedEtag, id): Promise<EventSkinsChange> => Promise.resolve({
      id: `${id}other`, eventId, after, expectedEtag, before: null, recordedAt: '2026-01-01T00:00:00Z',
      recordedBy: { tenantId: purseTestId(1), objectId: purseTestId(2) },
    }));
    render(<EventSkinsSettings {...props} />);
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Save event skins settings' }));
    await screen.findByText(/Save is not confirmed/);
    expect(screen.getByRole('checkbox')).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Retry event skins save' }));
    await screen.findByText(/Unrelated save acknowledgement/);
    expect(props.onSaved).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Retry event skins save' }));
    await waitFor(() => { expect(props.onSaved).toHaveBeenCalledOnce(); });
    expect(props.configure.mock.calls.map((call) => call.slice(0, 4))).toEqual([
      props.configure.mock.calls[0]?.slice(0, 4), props.configure.mock.calls[0]?.slice(0, 4), props.configure.mock.calls[0]?.slice(0, 4),
    ]);
  });
  it('hides controls for public, archived, tester or unsupported access even when supplied a configure callback', () => {
    const props = fixture();
    const view = render(<EventSkinsSettings {...props} workspace={{ ...props.workspace,
      event: { ...props.workspace.event, role: 'viewer' } }} />);
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    view.rerender(<EventSkinsSettings {...props} workspace={{ ...props.workspace, event: { ...props.workspace.event, status: 'archived' } }} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(props.configure).not.toHaveBeenCalled();
  });
});
