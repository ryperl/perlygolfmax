import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { KpEntryButton } from './KpEntryButton';

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
describe('KP measurement dialog', () => {
  it('focuses its heading, requires explicit whole ft/in and green confirmation, then stages zero without claiming saved', async () => {
    const change = vi.fn();
    render(<KpEntryButton name="Fictional golfer" disabled={false} onChange={change} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'KP for Fictional golfer' }));
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByRole('heading')).toHaveFocus();
    expect(dialog.getByRole('button', { name: 'Stage measurement' })).toBeDisabled();
    await user.type(dialog.getByLabelText('Feet'), '0');
    await user.type(dialog.getByLabelText('Inches (0–11)'), '12');
    await user.click(dialog.getByLabelText('Ball finished on the green'));
    expect(dialog.getByRole('button', { name: 'Stage measurement' })).toBeDisabled();
    await user.clear(dialog.getByLabelText('Inches (0–11)'));
    await user.type(dialog.getByLabelText('Inches (0–11)'), '0');
    await user.click(dialog.getByRole('button', { name: 'Stage measurement' }));
    expect(change).toHaveBeenCalledWith(expect.objectContaining({ kind: 'measured', inches: 0, onGreen: true }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: 'KP for Fictional golfer' })).toHaveFocus();
  });
  it('stages No measurement and explicit clearing without inventing distance or changing the saved value on cancel', () => {
    const change = vi.fn();
    render(<KpEntryButton name="Fictional golfer" disabled={false} value={{ kind: 'no-measurement' }} onChange={change} />);
    const trigger = screen.getByRole('button', { name: 'KP for Fictional golfer' });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('button', { name: 'No measurement' }));
    expect(change).toHaveBeenLastCalledWith({ kind: 'no-measurement' });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('button', { name: 'Clear KP entry' }));
    expect(change).toHaveBeenLastCalledWith(null);
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(change).toHaveBeenCalledTimes(2);
  });
});
