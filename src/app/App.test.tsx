import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from './App';

function navigate(hash: string) {
  act(() => {
    window.history.replaceState(null, '', hash || '/');
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });
}

beforeEach(() => { window.history.replaceState(null, '', '/'); });

describe('App', () => {
  it('opens the fictional overview with honest capability disclosures', () => {
    render(<App />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('The Coastal Classic');
    expect(screen.getByText('Fictional data. Nothing here is saved or synced.')).toBeVisible();
    expect(screen.getByText(/not a live scoreboard/)).toBeVisible();
    expect(screen.getByRole('link', { name: 'Overview' })).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByRole('button', { name: /sign in|save|sync|score/i })).not.toBeInTheDocument();
  });

  it('navigates through every view and moves focus to the content', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('link', { name: 'Explore the rounds' }));
    expect(await screen.findByRole('heading', { level: 1, name: /Five days/ })).toBeVisible();
    expect(within(screen.getByRole('list')).getAllByRole('listitem')).toHaveLength(5);
    expect(screen.getByRole('main')).toHaveFocus();
    expect(document.title).toBe('Rounds | Perly Golf Max');
    await user.click(screen.getByRole('link', { name: 'The group' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Meet the group.' })).toBeVisible();
    expect(within(screen.getByRole('list')).getAllByRole('listitem')).toHaveLength(12);
    await user.click(screen.getByRole('link', { name: 'Perly Golf Max home' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'The Coastal Classic' })).toBeVisible();
  });

  it('supports direct links, history changes, and unknown destinations', () => {
    navigate('#group');
    render(<App />);
    expect(screen.getByRole('heading', { name: 'Meet the group.' })).toBeVisible();
    navigate('#rounds');
    expect(screen.getByRole('link', { name: 'Rounds' })).toHaveAttribute('aria-current', 'page');
    navigate('#missing');
    expect(screen.getByRole('heading', { name: 'The Coastal Classic' })).toBeVisible();
  });

  it('provides a skip link without changing the current view', async () => {
    navigate('#group');
    const user = userEvent.setup();
    render(<App />);
    await user.tab();
    expect(screen.getByRole('link', { name: 'Skip to content' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('main')).toHaveFocus();
    expect(window.location.hash).toBe('#group');
  });
});
