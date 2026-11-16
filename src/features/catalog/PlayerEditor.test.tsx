import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { fakeCatalog, fictionalId, fictionalPlayers } from '../../client/catalog.test-support';
import type { PlayerIndexHistory } from '../../domain/catalog';
import { PlayerEditor } from './PlayerEditor';

const player = fictionalPlayers[0];
if (!player) throw new Error('Missing fictional player');

describe('focused player editor', () => {
  it('keeps edits locked until initial history settles and hides audit identities behind history details', async () => {
    const client = fakeCatalog();
    let finish: ((history: PlayerIndexHistory) => void) | undefined;
    const history = new Promise<PlayerIndexHistory>((resolve) => { finish = resolve; });
    vi.mocked(client.history).mockReturnValueOnce(history);
    render(<PlayerEditor client={client} player={player} onSaved={vi.fn()} onBusy={vi.fn()} onDirty={vi.fn()} blocked={false} onClose={vi.fn()} />);
    expect(screen.getByLabelText('Saved player name')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Close player editor' })).toBeDisabled();
    await act(async () => { finish?.({ observations: [{
      id: fictionalId(501), value: '0', effectiveDate: '2026-01-01', source: 'Fictional report',
      recordedAt: '2026-01-02T00:00:00Z', recordedBy: { tenantId: fictionalId(502), objectId: fictionalId(503) }, previousObservationId: null,
    }] }); await history; });
    expect(screen.getByRole('heading', { name: `Edit saved player: ${player.displayName}` })).toHaveFocus();
    expect(screen.queryByRole('heading', { name: 'Audited index history' })).not.toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'History' }));
    const audit = screen.getByText(/recorded by/);
    expect(audit).not.toBeVisible();
    await user.click(screen.getByText('Observation details', { selector: 'summary' }));
    expect(audit).toBeVisible();
    expect(audit).toHaveTextContent(fictionalId(503));
  });
  it('reports a confirmed index save separately when only its following history refresh fails', async () => {
    const client = fakeCatalog();
    const observation = { id: fictionalId(510), value: '+1.2', effectiveDate: '2026-01-01', source: 'Fictional report',
      recordedAt: '2026-01-02T00:00:00Z', recordedBy: { tenantId: fictionalId(511), objectId: fictionalId(512) }, previousObservationId: null };
    const updated = { ...player, currentIndex: observation, etag: 'player-v2' };
    vi.mocked(client.recordIndex).mockResolvedValue(updated);
    vi.mocked(client.history).mockResolvedValueOnce({ observations: [] }).mockRejectedValueOnce(new Error('History unavailable'));
    const saved = vi.fn();
    render(<PlayerEditor client={client} player={player} onSaved={saved} onBusy={vi.fn()} onDirty={vi.fn()} blocked={false} onClose={vi.fn()} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Handicap' }));
    await user.type(screen.getByLabelText('Handicap index (explicit + supported)'), '+1.2');
    await user.type(screen.getByLabelText('Effective date'), '2026-01-01');
    await user.type(screen.getByLabelText('Manual source'), 'Fictional report');
    await user.click(screen.getByRole('checkbox', { name: /I confirm/ }));
    await user.click(screen.getByRole('button', { name: 'Save manual index' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Observation saved, but history could not be refreshed');
    expect(saved).toHaveBeenCalledWith(updated);
    expect(screen.getByLabelText('Handicap index (explicit + supported)')).toHaveValue('');
    expect(client.recordIndex).toHaveBeenCalledOnce();
  });
});
