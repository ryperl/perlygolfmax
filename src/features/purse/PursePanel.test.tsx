import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { fictionalPurse, fictionalPurseSave } from '../../../tests/smoke/purse-fixture-data';
import { EventChangedError } from '../../client/events';
import type { EventPurseView, PurseWriteResult } from '../../domain/purse-settings';
import type { PursePlan, PurseTieResolution } from '../../domain/purse';
import { purseTestId } from '../../domain/purse.test-support';
import { PursePanel } from './index';

function callbacks() {
  const value = fictionalPurse();
  return { value, busy: false, onDirtyChange: vi.fn(),
    onSave: vi.fn<(plan: PursePlan, resolutions: readonly PurseTieResolution[], etag: string | null, id: string) => Promise<PurseWriteResult | null>>(
      async (plan, resolutions, etag, id) => Promise.resolve(fictionalPurseSave(value, plan, resolutions, etag, id))),
    onRefresh: vi.fn<() => Promise<EventPurseView | null>>(async () => Promise.resolve(value)) };
}
function edit() {
  fireEvent.click(screen.getByRole('button', { name: 'Edit purse' }));
  fireEvent.change(screen.getByLabelText('Planned budget amount'), { target: { value: '9.99' } });
}

describe('PursePanel save workflow', () => {
  it('handles empty unconfigured and archived panels honestly without assumed winnings or controls', () => {
    const props = callbacks();
    const value = { ...props.value, configuration: { ...props.value.configuration, plan: null }, view: null };
    const rendered = render(<PursePanel {...props} value={value} />);
    expect(screen.getByText(/There is no assumed budget or winnings total/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Configure purse' }));
    expect(screen.getByLabelText('Currency')).toHaveValue('USD');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel purse editing' }));
    expect(props.onDirtyChange).toHaveBeenLastCalledWith(false);
    rendered.rerender(<PursePanel {...props} value={{ ...value, workspace: { ...value.workspace,
      event: { ...value.workspace.event, status: 'archived' } } }} />);
    expect(screen.getByText(/archived. Purse settings are read-only/)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Configure purse' })).not.toBeInTheDocument();
  });
  it('saves the full plan with edit-time base and exact audit acknowledgement, without rendering audit data', async () => {
    const props = callbacks();
    render(<PursePanel {...props} />);
    edit();
    expect(props.onDirtyChange).toHaveBeenLastCalledWith(true);
    fireEvent.click(screen.getByRole('button', { name: 'Save purse' }));
    await screen.findByText(/Purse settings saved/);
    const call = props.onSave.mock.calls[0];
    expect(call?.[0].pools).toEqual(props.value.configuration.plan?.pools);
    expect(call?.[0].funding).toEqual({ kind: 'fixed', budgetMinor: 999 });
    expect(call?.[2]).toBe('fictional-purse');
    expect(call?.[3]).toMatch(/^[a-f0-9-]{36}$/);
    expect(props.onDirtyChange).toHaveBeenLastCalledWith(false);
    expect(screen.queryByText(purseTestId(9002))).not.toBeInTheDocument();
    expect(screen.getByText('Planned budget').nextElementSibling).toHaveTextContent('9.99');
  });
  it('retains the request ID/base/whole plan through null responses and uncertain failure retries', async () => {
    const props = callbacks();
    props.onSave.mockResolvedValueOnce(null).mockRejectedValueOnce(new Error('Uncertain transport'));
    render(<PursePanel {...props} />);
    edit();
    fireEvent.click(screen.getByRole('button', { name: 'Save purse' }));
    await screen.findByText(/Save is not confirmed/);
    expect(screen.getByLabelText('Planned budget amount')).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Retry purse save' }));
    await waitFor(() => { expect(props.onSave).toHaveBeenCalledTimes(2); });
    await waitFor(() => { expect(screen.getByRole('button', { name: 'Retry purse save' })).toBeEnabled(); });
    fireEvent.click(screen.getByRole('button', { name: 'Retry purse save' }));
    await screen.findByText(/Purse settings saved/);
    expect(props.onSave.mock.calls[0]).toEqual(props.onSave.mock.calls[1]);
    expect(props.onSave.mock.calls[1]).toEqual(props.onSave.mock.calls[2]);
  });
  it.each(['id', 'base', 'before', 'plan', 'resolutions'] as const)('does not accept an unrelated %s acknowledgement', async (part) => {
    const props = callbacks();
    props.onSave.mockImplementation(async (plan, resolutions, etag, id) => {
      const result = fictionalPurseSave(props.value, plan, resolutions, etag, id);
      return Promise.resolve({ ...result, change: { ...result.change,
        ...(part === 'id' ? { id: purseTestId(999) } : {}),
        ...(part === 'base' ? { expectedEtag: 'other-base' } : {}),
        ...(part === 'before' ? { before: { plan: null, resolutions: [] } } : {}),
        ...(part === 'plan' ? { after: { ...result.change.after, plan: { ...plan, currency: 'CAD' } } } : {}),
        ...(part === 'resolutions' ? { after: { ...result.change.after, resolutions: [{
          poolId: purseTestId(5000), rank: 1, orderedEntrantIds: [purseTestId(1), purseTestId(2)],
        }] } } : {}),
      } });
    });
    render(<PursePanel {...props} />);
    edit();
    fireEvent.click(screen.getByRole('button', { name: 'Save purse' }));
    await screen.findByText(/Save is not confirmed/);
    expect(props.onDirtyChange).not.toHaveBeenCalledWith(false);
    expect(screen.getByRole('button', { name: 'Retry purse save' })).toBeEnabled();
  });
  it('requires explicit refresh/review when acknowledged current config differs, preserving untouched concurrent pools', async () => {
    const props = callbacks();
    const plan = props.value.configuration.plan;
    const pool = plan?.pools[0];
    if (!plan || !pool) throw new Error('Missing fictional pool.');
    const latestPlan: PursePlan = { ...plan, pools: [pool, { ...pool, id: purseTestId(5001), name: 'Concurrent award' }] };
    const latest = fictionalPurseSave(props.value, latestPlan, [], 'fictional-purse', purseTestId(8000)).current;
    props.onSave.mockImplementationOnce(async (intended, decisions, etag, id) => Promise.resolve({
      ...fictionalPurseSave(props.value, intended, decisions, etag, id), current: latest,
    }));
    props.onRefresh.mockResolvedValue(latest);
    render(<PursePanel {...props} />);
    edit();
    fireEvent.change(screen.getByLabelText('Pool 1 name'), { target: { value: 'My award' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save purse' }));
    await screen.findByText(/Your save was acknowledged, but the latest configuration differs/);
    expect(screen.getByRole('button', { name: 'Retry purse save' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh latest purse' }));
    await screen.findByText(/Latest purse loaded for review/);
    fireEvent.click(screen.getByRole('button', { name: 'Review my draft against latest purse' }));
    expect(screen.getByLabelText('Pool 1 name')).toHaveValue('Concurrent award');
    expect(screen.getByLabelText('Pool 2 name')).toHaveValue('My award');
    expect(screen.getByLabelText('Planned budget amount')).toHaveValue('9.99');
    props.onSave.mockImplementation(async (intended, decisions, etag, id) =>
      Promise.resolve(fictionalPurseSave(latest, intended, decisions, etag, id)));
    fireEvent.click(screen.getByRole('button', { name: 'Save purse' }));
    await screen.findByText(/Purse settings saved/);
    expect(props.onSave.mock.calls[1]?.[2]).toBe('fictional-next');
    expect(props.onSave.mock.calls[1]?.[3]).not.toBe(props.onSave.mock.calls[0]?.[3]);
  });
  it('preserves conflicts, failed or mismatched refresh, and read-only archived refresh', async () => {
    const props = callbacks();
    props.onSave.mockRejectedValue(new EventChangedError());
    props.onRefresh.mockResolvedValueOnce(null).mockResolvedValueOnce({ ...props.value,
      configuration: { ...props.value.configuration, eventId: purseTestId(999) } }).mockResolvedValueOnce({
      ...props.value, workspace: { ...props.value.workspace, event: { ...props.value.workspace.event, status: 'archived' } },
    });
    render(<PursePanel {...props} />);
    edit();
    fireEvent.click(screen.getByRole('button', { name: 'Save purse' }));
    await screen.findByText(/Purse settings changed/);
    for (let index = 0; index < 2; index++) {
      fireEvent.click(screen.getByRole('button', { name: 'Refresh latest purse' }));
      await screen.findByText(/Refresh is not confirmed/);
      await waitFor(() => { expect(screen.getByRole('button', { name: 'Refresh latest purse' })).toBeEnabled(); });
    }
    fireEvent.click(screen.getByRole('button', { name: 'Refresh latest purse' }));
    await screen.findByText(/refreshed event is archived/);
    expect(screen.getByRole('button', { name: 'Review my draft against latest purse' })).toBeDisabled();
    expect(screen.getByLabelText('Planned budget amount')).toHaveValue('9.99');
    expect(screen.getByRole('button', { name: 'Retry purse save' })).toBeDisabled();
  });
  it('isolates private drafts when event identity changes and prevents overlapping saves while busy', async () => {
    const props = callbacks();
    let resolve: (value: PurseWriteResult | null) => void = () => { throw new Error('Not pending.'); };
    props.onSave.mockImplementation(() => new Promise((done) => { resolve = done; }));
    const rendered = render(<PursePanel {...props} />);
    edit();
    fireEvent.click(screen.getByRole('button', { name: 'Save purse' }));
    expect(screen.getByRole('button', { name: 'Retry purse save' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel purse editing' })).toBeDisabled();
    expect(props.onSave).toHaveBeenCalledTimes(1);
    resolve(null);
    await screen.findByText(/Save is not confirmed/);
    rendered.rerender(<PursePanel {...props} busy />);
    expect(screen.getByLabelText('Currency')).toBeDisabled();
    rendered.rerender(<PursePanel {...props} value={{ ...props.value, workspace: { ...props.value.workspace,
      event: { ...props.value.workspace.event, id: purseTestId(9999) } } }} />);
    expect(screen.queryByLabelText('Planned budget amount')).not.toBeInTheDocument();
    expect(props.onDirtyChange).toHaveBeenLastCalledWith(false);
  });
  it('retains a stale shape-valid saved tie decision for removal instead of blocking the entire editor', async () => {
    const props = callbacks();
    const plan = props.value.configuration.plan;
    const pool = plan?.pools[0];
    if (!plan || !pool || !('prizes' in pool)) throw new Error('Missing fictional ranked pool.');
    const stalePlan: PursePlan = { ...plan, pools: [{ ...pool, tiePolicy: 'organizer' }] };
    const staleResolutions = [{ poolId: pool.id, rank: 1, orderedEntrantIds: [purseTestId(1), purseTestId(2)] }];
    const value = fictionalPurseSave(props.value, stalePlan, staleResolutions, 'fictional-purse', purseTestId(8888)).current;
    props.onSave.mockImplementation(async (intended, decisions, etag, id) =>
      Promise.resolve(fictionalPurseSave(value, intended, decisions, etag, id)));
    render(<PursePanel {...props} value={value} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit purse' }));
    expect(screen.getByRole('button', { name: 'Save purse' })).toBeDisabled();
    expect(screen.getByText('A tie decision is stale or invalid. Remove or re-resolve it before saving.')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Remove stale decision for pool 1 place 1' }));
    expect(screen.getByRole('button', { name: 'Save purse' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Save purse' }));
    await screen.findByText(/Purse settings saved/);
    expect(props.onSave.mock.calls[0]?.[1]).toEqual([]);
  });
  it('pauses saving on a concurrent prop update until explicit refresh and review, without losing the full local draft', () => {
    const props = callbacks();
    const rendered = render(<PursePanel {...props} />);
    edit();
    const plan = props.value.configuration.plan;
    if (!plan) throw new Error('Missing fictional plan.');
    const changed = { ...props.value, configuration: { ...props.value.configuration, etag: 'concurrent',
      plan: { ...plan, currency: 'CAD' as const } } };
    rendered.rerender(<PursePanel {...props} value={changed} />);
    expect(screen.getByText(/Review required/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Save purse' })).toBeDisabled();
    expect(screen.getByLabelText('Planned budget amount')).toHaveValue('9.99');
  });
});
