import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PublicPlayerForm } from './PublicPlayerForm';
import { PrivateRequestError } from '../../client/private-request';
import { fictionalId } from '../../client/catalog.test-support';
import type { QuickRoundClient } from '../../client/quick-round';

const input = { displayName: 'Fictional New Golfer', handicapIndexValue: '+0.4' };
function open() {
  fireEvent.click(screen.getByRole('button', { name: 'New player' }));
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: input.displayName } });
  fireEvent.change(screen.getByLabelText('GHIN Handicap Index (as entered)'), { target: { value: input.handicapIndexValue } });
}

describe('public create-only player form', () => {
  it('retains a pending creation while availability changes and acknowledges through the latest callback', async () => {
    let confirm: (() => void) | undefined;
    const create = vi.fn<NonNullable<QuickRoundClient['createPlayer']>>().mockImplementation((_input, _id, signal) => new Promise((resolve) => {
      confirm = () => { expect(signal.aborted).toBe(false); resolve({ id: fictionalId(983), ...input }); };
    }));
    const first = vi.fn(), latest = vi.fn(), blocked = vi.fn();
    const view = render(<PublicPlayerForm create={create} disabled={false} onCreated={first} onBlockingChange={blocked} />);
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Create player' }));
    await waitFor(() => { expect(confirm).toBeDefined(); });
    view.rerender(<PublicPlayerForm create={create} disabled available={false} onCreated={latest} onBlockingChange={blocked} />);
    expect(screen.getByRole('dialog')).toBeVisible();
    expect(screen.getByLabelText('Name')).toHaveValue(input.displayName);
    expect(screen.queryByRole('button', { name: 'New player' })).not.toBeInTheDocument();
    await act(() => Promise.resolve(confirm?.()));
    expect(first).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledWith({ id: fictionalId(983), ...input });
    expect(create).toHaveBeenCalledOnce();
  });
  it('requires both fields and acknowledges creation separately from round saving', async () => {
    const create = vi.fn<NonNullable<QuickRoundClient['createPlayer']>>().mockResolvedValue({ id: fictionalId(980), ...input });
    const onCreated = vi.fn(), blocked = vi.fn();
    render(<PublicPlayerForm create={create} disabled={false} onCreated={onCreated} onBlockingChange={blocked} />);
    fireEvent.click(screen.getByRole('button', { name: 'New player' }));
    expect(screen.getByRole('heading', { name: 'New shared player' })).toHaveFocus();
    expect(screen.getAllByRole('textbox')).toHaveLength(2);
    fireEvent.submit(screen.getByRole('form', { name: 'Create shared player' }));
    expect(create).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: input.displayName } });
    fireEvent.change(screen.getByLabelText('GHIN Handicap Index (as entered)'), { target: { value: input.handicapIndexValue } });
    fireEvent.click(screen.getByRole('button', { name: 'Create player' }));
    await waitFor(() => { expect(onCreated).toHaveBeenCalledWith({ id: fictionalId(980), ...input }); });
    expect(create.mock.calls[0]?.[0]).toEqual(input);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(blocked).toHaveBeenLastCalledWith(false);
  });

  it('keeps exact uncertain attempts through retry quota failure, warns on close/navigation, and confirms one creation', async () => {
    const create = vi.fn<NonNullable<QuickRoundClient['createPlayer']>>()
      .mockRejectedValueOnce(new Error('Fictional lost acknowledgement'))
      .mockRejectedValueOnce(new PrivateRequestError(429, 'Fictional quota'))
      .mockResolvedValueOnce({ id: fictionalId(981), ...input });
    const onCreated = vi.fn();
    render(<PublicPlayerForm create={create} disabled={false} onCreated={onCreated} onBlockingChange={vi.fn()} />);
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Create player' }));
    await screen.findByRole('button', { name: 'Retry player creation' });
    expect(screen.getByLabelText('Name')).toBeDisabled();
    expect(screen.getByLabelText('GHIN Handicap Index (as entered)')).toHaveValue('+0.4');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel new player' }));
    expect(screen.getByText(/Discard these entries/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Keep entries' }));
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const hash = window.location.hash;
    act(() => {
      window.history.replaceState(null, '', '#events?choose=1');
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('unconfirmed creation'));
    expect(window.location.hash).toBe(hash);
    confirm.mockRestore();
    fireEvent.click(screen.getByRole('button', { name: 'Retry player creation' }));
    await waitFor(() => { expect(create).toHaveBeenCalledTimes(2); expect(screen.getByRole('button', { name: 'Retry player creation' })).toBeEnabled(); });
    expect(screen.getByLabelText('Name')).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Retry player creation' }));
    await waitFor(() => { expect(onCreated).toHaveBeenCalledOnce(); });
    expect(create.mock.calls.map((call) => call[1])).toEqual(Array(3).fill(create.mock.calls[0]?.[1]));
    expect(create.mock.calls.map((call) => call[0])).toEqual([input, input, input]);
  });

  it('allows editing a known pre-write rejection with a fresh identity, without discarding fields', async () => {
    const create = vi.fn<NonNullable<QuickRoundClient['createPlayer']>>()
      .mockRejectedValueOnce(new PrivateRequestError(400, 'Fictional validation'))
      .mockResolvedValueOnce({ id: fictionalId(982), ...input, handicapIndexValue: '0' });
    render(<PublicPlayerForm create={create} disabled={false} onCreated={vi.fn()} onBlockingChange={vi.fn()} />);
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Create player' }));
    await screen.findByRole('alert');
    expect(screen.getByLabelText('Name')).toHaveValue(input.displayName);
    expect(screen.getByLabelText('Name')).toBeEnabled();
    fireEvent.change(screen.getByLabelText('GHIN Handicap Index (as entered)'), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: 'Retry player creation' }));
    await waitFor(() => { expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); });
    expect(create.mock.calls[0]?.[1]).not.toBe(create.mock.calls[1]?.[1]);
  });
});
