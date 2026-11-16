import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { RoundCorrectionsDialog } from './RoundCorrectionsDialog';
import { fictionalCorrection, fictionalCorrectionResult } from './corrections.test-support';
import type { RoundCorrectionsClient } from '../../client/round-corrections';
import type { RoundCorrectionReadModel } from '../../domain/round-corrections';
import { PrivateRequestError } from '../../client/private-request';

beforeAll(() => {
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: { configurable: true, value(this: HTMLDialogElement) { this.setAttribute('open', ''); } },
    close: { configurable: true, value(this: HTMLDialogElement) { this.removeAttribute('open'); } },
  });
});
afterAll(() => {
  Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal');
  Reflect.deleteProperty(HTMLDialogElement.prototype, 'close');
});
describe('explicit audited round correction editor', () => {
  it('clears private correction inputs and drafts when ownership ends', async () => {
    const model = fictionalCorrection();
    const client = { load: vi.fn().mockResolvedValue(model),
      save: vi.fn<RoundCorrectionsClient['save']>().mockRejectedValue(new PrivateRequestError(403, 'Owner access ended')) };
    const user = userEvent.setup();
    render(<RoundCorrectionsDialog client={client} eventId={model.eventId} roundId={model.roundId}
      roundName="Fictional round" onClose={vi.fn()} onSessionExpired={vi.fn()} />);
    const index = await screen.findByLabelText('Captured Handicap Index');
    await user.clear(index); await user.type(index, '1.2');
    await user.type(screen.getByLabelText('Correction reason'), 'Repair fictional inputs');
    await user.click(screen.getByRole('checkbox', { name: /I reviewed/ }));
    await user.click(screen.getByRole('button', { name: 'Save audited correction' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Owner access ended');
    expect(screen.queryByLabelText('Captured Handicap Index')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save audited correction' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back to scores' })).toBeEnabled();
  });
  it('requires reason/review, preserves failed edits and operation ID, then adopts the acknowledged model', async () => {
    const model = fictionalCorrection();
    const save = vi.fn<RoundCorrectionsClient['save']>().mockRejectedValueOnce(new Error('Uncertain response'))
      .mockImplementation((_event, _round, body) => Promise.resolve(fictionalCorrectionResult(model, body)));
    const client = { load: vi.fn().mockResolvedValue(model), save };
    const close = vi.fn();
    const user = userEvent.setup();
    render(<RoundCorrectionsDialog client={client} eventId={model.eventId} roundId={model.roundId}
      roundName="Fictional round" onClose={close} onSessionExpired={vi.fn()} />);
    const index = await screen.findByLabelText('Captured Handicap Index');
    expect(screen.getByRole('heading', { level: 2 })).toHaveFocus();
    await user.clear(index); await user.type(index, '1.2');
    await user.selectOptions(screen.getByLabelText('Golfer tee'), '701');
    expect(screen.getByRole('button', { name: 'Save audited correction' })).toBeDisabled();
    await user.type(screen.getByLabelText('Correction reason'), 'Repair a fictional captured value');
    await user.click(screen.getByRole('checkbox', { name: /I reviewed/ }));
    fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }));
    expect(close).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Save audited correction' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Draft retained');
    expect(index).toHaveValue('1.2');
    expect(screen.getByRole('button', { name: 'Back to scores' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Save audited correction' }));
    expect(await screen.findByText(/Correction saved\./)).toBeVisible();
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[0]?.[3]).toBe(save.mock.calls[1]?.[3]);
    expect(save.mock.calls[0]?.[2]).toMatchObject({ expected: { eventEtag: model.eventEtag, roundEtag: model.roundEtag },
      correction: { players: model.players.map((player, index) => ({ playerId: player.playerId,
        handicapIndexValue: index === 0 ? '1.2' : player.handicapIndex?.value ?? null })),
        playerTeeSelections: [{ playerId: model.players[0]?.playerId, teeProfileId: 701 }] } });
    expect(JSON.stringify(save.mock.calls[0]?.[2])).not.toMatch(/recordedBy|recordedAt|observationId/);
    await user.click(screen.getByRole('button', { name: 'Back to scores' }));
    expect(close).toHaveBeenCalledOnce();
  });
  it('explicitly discards/reloads, validates NH and isolates late results after a connection change', async () => {
    const model = fictionalCorrection();
    const first = { load: vi.fn().mockResolvedValue(model), save: vi.fn<RoundCorrectionsClient['save']>() };
    const user = userEvent.setup();
    const props = { eventId: model.eventId, roundId: model.roundId, roundName: 'Fictional round', onClose: vi.fn(), onSessionExpired: vi.fn() };
    const view = render(<RoundCorrectionsDialog {...props} client={first} />);
    await screen.findByLabelText('Captured Handicap Index');
    await user.click(screen.getByLabelText('No Handicap Index (NH)'));
    expect(screen.getByLabelText('Captured Handicap Index')).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Discard draft and reload' }));
    expect(await screen.findByLabelText('Captured Handicap Index')).toHaveValue('0');
    let resolve: ((model: RoundCorrectionReadModel) => void) | undefined;
    const next = { load: vi.fn().mockImplementation(() => new Promise<RoundCorrectionReadModel>((done) => { resolve = done; })),
      save: vi.fn<RoundCorrectionsClient['save']>() };
    view.rerender(<RoundCorrectionsDialog {...props} client={next} />);
    expect(screen.queryByLabelText('Captured Handicap Index')).not.toBeInTheDocument();
    view.unmount();
    await act(() => { resolve?.(model); return Promise.resolve(); });
    expect(next.load.mock.calls[0]?.[2]).toMatchObject({ aborted: true });
    expect(first.save).not.toHaveBeenCalled();
    expect(next.save).not.toHaveBeenCalled();
  });
});
