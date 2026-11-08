import { fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ChurchyDots } from './ChurchyDots';
import { churchyFixture } from '../../domain/churchy.test-support';

beforeAll(() => {
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: { configurable: true, value(this: HTMLDialogElement) { this.setAttribute('open', ''); } },
    close: { configurable: true, value(this: HTMLDialogElement) { this.removeAttribute('open'); this.dispatchEvent(new Event('close')); } },
  });
});
afterAll(() => {
  Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal');
  Reflect.deleteProperty(HTMLDialogElement.prototype, 'close');
});
describe('compact Churchy dots dialog', () => {
  it('opens without a keyboard and stages called specials/ordered team presses, returning focus to Dots', () => {
    const f = churchyFixture();
    function Harness() {
      const [value, setValue] = useState(f.extras);
      return <ChurchyDots name="Fictional golfer" number={1} value={value} disabled={false} onChange={setValue} />;
    }
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Dots for Fictional golfer' });
    expect(trigger).toHaveTextContent('0 selected');
    expect(trigger).toHaveAccessibleDescription('No specials selected. Selections are not awarded dots; gross birdie is automatic.');
    fireEvent.click(trigger);
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.queryByRole('textbox')).toBeNull();
    expect(dialog.getByRole('button', { name: /Opposing team presses/ })).toBeDisabled();
    fireEvent.click(dialog.getByLabelText(/Murphy called/));
    expect(dialog.getByRole('button', { name: /Calling team presses back/ })).toBeDisabled();
    fireEvent.click(dialog.getByRole('button', { name: /Opposing team presses/ }));
    fireEvent.click(dialog.getByRole('button', { name: /Calling team presses back/ }));
    expect(dialog.getByText(/Murphy: 3 dots/)).toBeVisible();
    expect(dialog.getByRole('button', { name: /Opposing team presses/ })).toBeDisabled();
    expect(dialog.getByRole('button', { name: /Calling team presses back/ })).toBeDisabled();
    fireEvent.click(dialog.getByLabelText(/Paree called/));
    expect(trigger).toHaveTextContent('2 selected');
    expect(trigger).toHaveAccessibleDescription('2 selected: Paree called; Murphy called (3-dot stage). Selections are not awarded dots; gross birdie is automatic.');
    expect(dialog.queryByLabelText(/Birdie/)).toBeNull();
    fireEvent.click(dialog.getByRole('button', { name: 'Return to score entry' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(trigger).toHaveFocus();
  });
  it('disabled cannot open an editor or change metadata', () => {
    const onChange = vi.fn();
    render(<ChurchyDots name="Fictional golfer" number={1} value={churchyFixture().extras} disabled onChange={onChange} />);
    expect(screen.getByRole('button', { name: 'Dots for Fictional golfer' })).toBeDisabled();
    expect(onChange).not.toHaveBeenCalled();
  });
});
