import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { AccessPolicy } from './AccessPolicy';

it('states all-active viewing, playing-group entry, and the private/archived boundaries', () => {
  render(<AccessPolicy />);
  expect(screen.getByText('all active events')).toBeVisible();
  expect(screen.getByText(/Archived events remain owner-only/)).toBeVisible();
  expect(screen.getByText(/Competition teams do not grant score entry/)).toBeVisible();
  expect(screen.getByText(/raw Handicap Index observations/)).toBeVisible();
});
