import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { eventSkinsFixture, withoutEventSkins } from '../../domain/event-skins.test-support';
import type { EventPurseView } from '../../domain/purse-settings';
import { fictionalPurseSave } from '../../../tests/smoke/purse-fixture-data';
import { PursePanel } from './index';
import type { PursePanelProps } from './index';
import { buildPurseDraft, newPool, selectSource, sourceChoices } from './purse-draft';

function fixture(): EventPurseView {
  const f = eventSkinsFixture(undefined, undefined, 3);
  return { workspace: f.workspace, roundScores: f.rounds,
    configuration: { eventId: f.workspace.event.id, etag: null, plan: null, resolutions: [] }, view: null };
}
describe('event skins purse source editor and winnings', () => {
  it('requires an explicit canonical amount and uses existing currency/budget accounting without altering other sources', async () => {
    const value = fixture();
    const onSave = vi.fn(async (...args: Parameters<PursePanelProps['onSave']>) =>
      Promise.resolve(fictionalPurseSave(value, ...args)));
    render(<PursePanel value={value} busy={false} onDirtyChange={vi.fn()} onSave={onSave} onRefresh={async () => Promise.resolve(value)} />);
    fireEvent.click(screen.getByRole('button', { name: 'Configure purse' }));
    fireEvent.change(screen.getByLabelText('Planned budget amount'), { target: { value: '100.01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add award pool' }));
    fireEvent.change(screen.getByLabelText('Pool 1 name'), { target: { value: 'Fictional Event Skins' } });
    fireEvent.change(screen.getByLabelText('Pool 1 source'), { target: { value: 'event-skins' } });
    expect(screen.getByLabelText('Event skins pot amount')).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Save purse' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Event skins pot amount'), { target: { value: '100.01' } });
    expect(screen.queryByLabelText(/tie policy/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Add place prize/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save purse' }));
    await screen.findByText(/Purse settings saved\./);
    expect(onSave.mock.calls[0]?.[0]).toMatchObject({
      currency: 'USD', funding: { kind: 'fixed', budgetMinor: 10001 },
      pools: [{ source: { kind: 'event-skins', version: 1 }, amountMinor: 10001, awardUnit: 'pot' }],
    });
    const pool = screen.getByText('Fictional Event Skins · calculated').closest('details');
    if (!pool) throw new Error('Missing fictional pool.');
    fireEvent.click(within(pool).getByText('Fictional Event Skins · calculated'));
    expect(within(pool).getByText(/fractional cents unallocated/)).toBeVisible();
    expect(within(pool).getByText(/Unallocated: USD 0.02/)).toBeVisible();
    expect(within(pool).getByText(/Current per-skin share: USD 33.33/)).toBeVisible();
    expect(within(pool).getByText(/Remaining potential awards: 0 pending holes/)).toBeVisible();
    expect(screen.getByRole('table')).toHaveTextContent('USD 99.99');
  });
  it('offers no event skins source on an unsupported/disabled API, and selecting it does not carry over an arbitrary existing amount', () => {
    const value = fixture();
    expect(sourceChoices({ ...value, workspace: withoutEventSkins(value.workspace) }).some((choice) => choice.key === 'event-skins')).toBe(false);
    const choice = sourceChoices(value).find((entry) => entry.key === 'event-skins');
    if (!choice) throw new Error('Missing fictional event skins source.');
    const draft = selectSource({ ...newPool('00000000-0000-4000-8000-000000000001'), amount: '3000.00' }, choice);
    expect(draft.amount).toBe('');
    expect(buildPurseDraft({ currency: 'USD', funding: 'fixed', amount: '100.00', pools: [draft] }, value.workspace.event.id)).toBeNull();
  });
});
