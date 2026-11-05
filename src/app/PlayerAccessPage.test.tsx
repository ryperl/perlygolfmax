import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { admissionsClient, management } from '../features/admission/test-support';
import { PlayerAccessPage } from './PlayerAccessPage';

it('composes the injected admission controller without constructing an identity SDK', async () => {
  const value = management();
  const client = admissionsClient(value);
  render(<PlayerAccessPage client={client} eventId={value.eventId} onSessionExpired={vi.fn()} />);
  expect(await screen.findByRole('combobox', { name: 'Saved roster golfer' })).toBeVisible();
  expect(client.list).toHaveBeenCalledWith(value.eventId, expect.any(AbortSignal));
});
