import { fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ChurchyDots } from './ChurchyDots';
import { churchyFixture } from '../../domain/churchy.test-support';
import type { ChurchyGameDefinition, ChurchySpecials } from '../../domain/churchy';
import { emptyChurchySpecials } from '../../domain/churchy';
import type { ChurchyCountTexts } from './churchy-counts';

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
  it('retains invalid count text through close/reopen, stages repeated Sandy/Other and unrestricted Sticky together', () => {
    const f = churchyFixture();
    const game: ChurchyGameDefinition = { ...f.game, version: 2, enabledSpecials: ['sandy', 'sticky', 'birdie', 'eagle'] };
    const changed = vi.fn();
    function Harness() {
      const [value, setValue] = useState(emptyChurchySpecials(game, f.extras.gameEtag));
      const [counts, setCounts] = useState<ChurchyCountTexts>();
      return <ChurchyDots name="Fictional golfer" number={1} game={game} value={value} counts={counts} disabled={false}
        onChange={(next, raw) => { changed(next); setValue(next); if (raw) setCounts(raw); }} />;
    }
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Dots for Fictional golfer' });
    expect(trigger.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    fireEvent.click(trigger);
    expect(screen.queryByLabelText(/Murphy called/)).toBeNull();
    expect(screen.queryByLabelText(/Paree called/)).toBeNull();
    fireEvent.change(screen.getByLabelText(/Sandy count/), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Other dots'), { target: { value: '-1.5' } });
    expect(screen.getByLabelText('Other dots')).toHaveValue('-1.5');
    expect(screen.getByLabelText('Other dots')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('Nothing in this group can save');
    fireEvent.click(screen.getByRole('button', { name: 'Return to score entry' }));
    fireEvent.click(trigger);
    expect(screen.getByLabelText('Other dots')).toHaveValue('-1.5');
    fireEvent.change(screen.getByLabelText('Other dots'), { target: { value: '3' } });
    fireEvent.click(screen.getByLabelText(/Sticky confirmed/));
    expect(changed).toHaveBeenLastCalledWith(expect.objectContaining({
      version: 2, sandyCount: 2, otherDots: 3, sticky: true,
    }));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByLabelText(/reason/i)).toBeNull();
    expect(screen.queryByLabelText(/Birdie/)).toBeNull();
    expect(screen.queryByLabelText(/Eagle/)).toBeNull();
  });
  it('opens without a keyboard and stages called specials/ordered team presses, returning focus to Dots', () => {
    const f = churchyFixture();
    function Harness() {
      const [value, setValue] = useState<ChurchySpecials>(f.extras);
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
