import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { DotsGameDescription } from './DotsGameDescription';

describe('selected Dots game description', () => {
  it('opens on demand and separates entered facts from automatic score awards', async () => {
    const user = userEvent.setup();
    render(<DotsGameDescription mode="fixed" manualSweep specials={[
      { kind: 'hogan', units: 1 }, { kind: 'murphy', units: 1 },
      { kind: 'birdie', units: 2 }, { kind: 'string', units: 1 }, { kind: 'sweep', units: 1 },
    ]} />);
    const summary = screen.getByText('How Dots works');
    expect(summary.closest('details')).not.toHaveAttribute('open');
    expect(screen.getByRole('region', { name: 'Dots game description' })).not.toBeVisible();
    await user.click(summary);
    const help = screen.getByRole('region', { name: 'Dots game description' });
    const lists = within(help).getAllByRole('list');
    expect(lists[0]).toHaveTextContent('Hogan:');
    expect(lists[0]).toHaveTextContent('Murphy:');
    expect(lists[0]).toHaveTextContent('Manual Sweep:');
    expect(lists[1]).toHaveTextContent('Birdie:');
    expect(lists[1]).toHaveTextContent('String:');
    expect(lists[1]).not.toHaveTextContent('Sweep');
    expect(help).toHaveTextContent('SO changes net comparisons, not Birdie or String');
    expect(help).toHaveTextContent('do not enter it again for the partner');
  });

  it('explains Category Sweep only when both categories are selected and never multiplies it', async () => {
    const user = userEvent.setup();
    const view = render(<DotsGameDescription mode="rotating" highLowVersion={2}
      specials={[{ kind: 'long-drive', units: 3 }, { kind: 'blue-plate', units: 5 }]} />);
    await user.click(screen.getByText('How Dots works'));
    const help = screen.getByRole('region', { name: 'Dots game description' });
    expect(help).toHaveTextContent('Automatic Category Sweep: The same golfer wins Long Drive and Blue Plate');
    expect(help).toHaveTextContent('one extra dot for that golfer and each current teammate');
    expect(help).toHaveTextContent('Different winners do not qualify');
    expect(help).toHaveTextContent('Carried dots and second qualifiers do not increase this bonus');
    expect(help).toHaveTextContent('a double win earns three dots per teammate');
    view.rerender(<DotsGameDescription mode="rotating" highLowVersion={2} specials={[{ kind: 'long-drive', units: 3 }]} />);
    expect(help).not.toHaveTextContent('Automatic Category Sweep:');
    expect(help).toHaveTextContent('Automatic High/Low Sweep');
  });

  it('keeps legacy linked Sweep automatic without claiming the new rotating High/Low bonus', async () => {
    const user = userEvent.setup();
    render(<DotsGameDescription mode="linked" specials={[{ kind: 'sweep', units: 2 }]} />);
    await user.click(screen.getByText('How Dots works'));
    const help = screen.getByRole('region', { name: 'Dots game description' });
    expect(help).toHaveTextContent('No entered specials selected');
    expect(help).toHaveTextContent('Legacy linked High/Low Sweep:');
    expect(help).not.toHaveTextContent('Automatic High/Low Sweep adds');
    expect(help).toHaveTextContent('Saved legacy games retain their original rules');
  });

  it('describes older High/Low without silently adding an automatic Sweep', async () => {
    const user = userEvent.setup();
    render(<DotsGameDescription mode="rotating" highLowVersion={1} specials={[]} />);
    await user.click(screen.getByText('How Dots works'));
    const help = screen.getByRole('region', { name: 'Dots game description' });
    expect(help).toHaveTextContent('Each contest earns one dot per winning teammate');
    expect(help).toHaveTextContent('This saved High/Low version has no automatic High/Low Sweep');
    expect(help).not.toHaveTextContent('High 1 + Low 1 + Sweep 1 = 3 each');
  });

  it('keeps empty individual games honest about awards, partners and solo money', async () => {
    const user = userEvent.setup();
    render(<DotsGameDescription mode="individual" specials={[]} />);
    await user.click(screen.getByText('How Dots works'));
    const help = screen.getByRole('region', { name: 'Dots game description' });
    expect(help).toHaveTextContent('No automatic awards selected');
    expect(help).toHaveTextContent('Individual awards go to the earning golfer');
    expect(help).toHaveTextContent('Solo play has no opponents or money settlement');
    expect(help).not.toHaveTextContent('credits each current teammate');
    expect(within(help).queryByRole('button')).not.toBeInTheDocument();
  });

  it('describes Nines-linked Dots as every golfer alone, with one Nines settlement', async () => {
    const user = userEvent.setup();
    render(<DotsGameDescription mode="linked" linkedToNines
      specials={[{ kind: 'long-drive', units: 1 }, { kind: 'blue-plate', units: 1 }]} />);
    await user.click(screen.getByText('How Dots works'));
    const help = screen.getByRole('region', { name: 'Dots game description' });
    expect(help).toHaveTextContent('Each golfer plays alone, so awards go to the earning golfer');
    expect(help).toHaveTextContent('award both opponents');
    expect(help).toHaveTextContent('combines Nines points and dots once at the Nines stake');
    expect(help).toHaveTextContent('Blue Plate on the same par-5 hole: one extra dot for that golfer.');
    expect(help).not.toHaveTextContent('teammate');
  });

  it('describes Murphy as succeeding at the called par or birdie target or better', async () => {
    const user = userEvent.setup();
    render(<DotsGameDescription specials={[{ kind: 'murphy', units: 1 }]} mode="fixed" />);
    await user.click(screen.getByText('How Dots works'));
    const help = screen.getByRole('region', { name: 'Dots game description' });
    expect(help).toHaveTextContent('a birdie makes a par call but a par misses a birdie call');
    expect(help).not.toHaveTextContent('Called up-and-down, gross par or better');
  });
});
