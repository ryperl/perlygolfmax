import { StrictMode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { admissionId, admissionsClient, status } from '../features/admission/test-support';
import { JoinEventPage } from './JoinEventPage';

it('uses the global sign-in control and keeps signed-out composition private', () => {
  const client = admissionsClient();
  render(<JoinEventPage client={client} eventId={admissionId(100)} inviteId={admissionId(200)}
    signedIn={false} onSessionExpired={vi.fn()} />);
  expect(screen.getByText(/Sign in using the button above/)).toBeVisible();
  expect(client.status).not.toHaveBeenCalled();
  expect(client.claim).not.toHaveBeenCalled();
});

it('forwards onApproved once for a resumed approved status, including strict effect replay', async () => {
  const client = admissionsClient();
  vi.mocked(client.status).mockResolvedValue(status('approved'));
  const onApproved = vi.fn();
  const props = { client, eventId: admissionId(100), inviteId: admissionId(200), signedIn: true,
    onSessionExpired: vi.fn(), onApproved };
  const f = render(<StrictMode><JoinEventPage {...props} /></StrictMode>);
  await screen.findByRole('link', { name: 'Open event overview' });
  await waitFor(() => { expect(onApproved).toHaveBeenCalledOnce(); });
  const updatedCallback = vi.fn();
  f.rerender(<StrictMode><JoinEventPage {...props} onApproved={updatedCallback} /></StrictMode>);
  expect(updatedCallback).not.toHaveBeenCalled();
  expect(onApproved).toHaveBeenCalledOnce();
});
