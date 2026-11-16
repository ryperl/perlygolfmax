import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { RoundAccent, roundToneFor } from './index';

describe('round appearance', () => {
  it('distinguishes configured rounds without depending on date order or mutating inputs', () => {
    const rounds = Object.freeze(Array.from({ length: 8 }, (_, index) => Object.freeze({
      id: `fictional-${String(index)}`, startDate: `2026-01-${String(8 - index).padStart(2, '0')}`,
    })));
    const tones = rounds.map((round) => roundToneFor(round.id, rounds));
    expect(new Set(tones).size).toBe(rounds.length);
    for (const round of [...rounds].reverse()) {
      expect(roundToneFor(round.id, rounds)).toBe(tones[rounds.indexOf(round)]);
    }
    expect(roundToneFor('missing', rounds)).toBeUndefined();
    expect(roundToneFor('missing', [])).toBeUndefined();
    expect(roundToneFor('later', [...rounds, { id: 'later' }])).toBeDefined();
  });
  it('changes only the accent without remounting or resetting a child control', async () => {
    const rounds = [{ id: 'first' }, { id: 'second' }];
    const children = <label>Selection<select defaultValue="one"><option value="one">One</option><option value="two">Two</option></select></label>;
    const view = render(<RoundAccent tone={roundToneFor('first', rounds)}>{children}</RoundAccent>);
    const select = screen.getByRole('combobox');
    const before = select.closest('[data-round-tone]')?.getAttribute('data-round-tone');
    await userEvent.selectOptions(select, 'two');
    view.rerender(<RoundAccent tone={roundToneFor('second', rounds)}>{children}</RoundAccent>);
    expect(screen.getByRole('combobox')).toBe(select);
    expect(select).toHaveValue('two');
    expect(select.closest('[data-round-tone]')?.getAttribute('data-round-tone')).not.toBe(before);
  });
});
