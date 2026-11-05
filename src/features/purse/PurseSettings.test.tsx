import { fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { fictionalPurse } from '../../../tests/smoke/purse-fixture-data';
import type { EventPurseView } from '../../domain/purse-settings';
import type { PurseTieResolution } from '../../domain/purse';
import { purseTestId } from '../../domain/purse.test-support';
import { buildPurseDraft, draftFromPlan, newPool } from './purse-draft';
import { PurseSettings } from './PurseSettings';

function Fixture({ value = fictionalPurse(40), disabled = false, manual = true }: {
  readonly value?: EventPurseView; readonly disabled?: boolean; readonly manual?: boolean;
}) {
  const [draft, setDraft] = useState(() => manual
    ? { ...draftFromPlan(value.configuration.plan), pools: [{ ...newPool(purseTestId(7000)), name: 'Fictional side pot' }] }
    : draftFromPlan(value.configuration.plan));
  const [resolutions, setResolutions] = useState<readonly PurseTieResolution[]>(value.configuration.resolutions);
  return <>
    <PurseSettings value={value} draft={draft} plan={buildPurseDraft(draft, value.workspace.event.id)}
      resolutions={resolutions} disabled={disabled} onChange={setDraft} onResolutions={setResolutions} />
    <output data-testid="draft">{JSON.stringify(draft)}</output><output data-testid="resolutions">{JSON.stringify(resolutions)}</output>
  </>;
}

describe('PurseSettings', () => {
  it('pages and searches forty explicit recipients without dropping hidden selected values', () => {
    render(<Fixture />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Fictional golfer 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next recipients' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Fictional golfer 13' }));
    fireEvent.change(screen.getByLabelText('Find recipients for Fictional side pot'), { target: { value: '40' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Fictional golfer 40' }));
    fireEvent.change(screen.getByLabelText('Find recipients for Fictional side pot'), { target: { value: '' } });
    expect(screen.getByRole('checkbox', { name: 'Fictional golfer 1' })).toBeChecked();
    expect(screen.getByText('3 recipients selected: Fictional golfer 1, Fictional golfer 13, Fictional golfer 40')).toBeVisible();
    expect(screen.getByTestId('draft')).toHaveTextContent(purseTestId(40));
    fireEvent.change(screen.getByLabelText('Currency'), { target: { value: 'GBP' } });
    fireEvent.change(screen.getByLabelText('Planned funding'), { target: { value: 'buy-in' } });
    fireEvent.change(screen.getByLabelText('Planned buy-in per golfer'), { target: { value: '1.23' } });
    expect(screen.getByText(/Buy-in uses all 40 current event golfers/)).toBeVisible();
  });
  it('adds/removes unsaved pools and uncapped place prizes, respecting actual team source defaults', () => {
    const value = fictionalPurse(8, 'four-two-net');
    render(<Fixture value={value} />);
    const source = screen.getByLabelText('Pool 1 source');
    const teamOption = within(source).getByRole('option', { name: /team awards/ });
    if (!(teamOption instanceof HTMLOptionElement)) throw new Error('Missing team option.');
    fireEvent.change(source, { target: { value: teamOption.value } });
    expect(screen.getByLabelText('Pool 1 award amount unit')).toHaveValue('per-team');
    fireEvent.change(screen.getByLabelText('Pool 1 award amount unit'), { target: { value: 'per-golfer' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add place prize to pool 1' }));
    expect(screen.getByLabelText('Pool 1 prize 2 amount')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Remove prize 2 from pool 1' }));
    expect(screen.queryByLabelText('Pool 1 prize 2 amount')).not.toBeInTheDocument();
    const addPool = screen.getByRole('button', { name: 'Add award pool' });
    for (let index = 0; index < 20; index++) fireEvent.click(addPool);
    expect(screen.getByLabelText('Pool 21 name')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Remove pool 21' }));
    expect(screen.queryByLabelText('Pool 21 name')).not.toBeInTheDocument();
  });
  it('requires explicit unique tied award ordering and exposes stale decision removal', () => {
    const original = fictionalPurse(4, undefined, [4, 5, 5, 6]);
    const plan = original.configuration.plan;
    const pool = plan?.pools[0];
    if (!plan || !pool || !('prizes' in pool)) throw new Error('Missing fictional ranked pool.');
    const organizer = { ...plan, pools: [{ ...pool, tiePolicy: 'organizer' as const }] };
    const stale = { poolId: pool.id, rank: 2, orderedEntrantIds: [purseTestId(1), purseTestId(2)] };
    render(<Fixture manual={false} value={{ ...original, configuration: { ...original.configuration, plan: organizer, resolutions: [stale] } }} />);
    expect(screen.getByText(/Stale or unavailable award decision/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Remove stale decision for pool 1 place 2' }));
    expect(screen.getByTestId('resolutions')).toHaveTextContent('[]');
    expect(screen.getByLabelText('Award position 2')).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Use this award order' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Award position 2'), { target: { value: purseTestId(3) } });
    fireEvent.change(screen.getByLabelText('Award position 3'), { target: { value: purseTestId(2) } });
    fireEvent.click(screen.getByRole('button', { name: 'Use this award order' }));
    expect(screen.getByText(/Current award decision · place 2: Fictional golfer 3 → Fictional golfer 2/)).toBeVisible();
  });
  it('disables every edit for busy/archived use and hints when overall is not configured', () => {
    const original = fictionalPurse();
    const { overallCompetition: _competition, ...workspace } = original.workspace;
    expect(_competition).toBeDefined();
    render(<Fixture value={{ ...original, workspace }} disabled />);
    expect(screen.getByText(/Overall awards are unavailable until/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Add award pool' })).toBeDisabled();
    expect(screen.getByLabelText('Currency')).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: 'Fictional golfer 1' })).toBeDisabled();
  });
});
