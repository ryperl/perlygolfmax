import { webcrypto } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAdmissionsClient, generateInvitationSecret, invitationUrl, readInvitationFragment } from './admission';
import { isAdmissionToken } from '../contracts/admission';
import { EventChangedError, SessionExpiredError } from './events';

const eventId = '00000000-0000-4000-8000-000000000001';
const inviteId = '00000000-0000-4000-8000-000000000002';
const requestId = '00000000-0000-4000-8000-000000000003';
const token = 'BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc';
const pending = { eventId, inviteId, state: 'pending', eventName: 'Fictional Open', displayName: 'Fictional Golfer', verificationCode: 'ABCD-1234' };

afterEach(() => vi.unstubAllGlobals());

describe('private admissions client', () => {
  it('generates 32 random bytes, hashes the exact base64url token and puts secrets only in a validated link fragment', async () => {
    vi.stubGlobal('crypto', webcrypto);
    const first = await generateInvitationSecret();
    const second = await generateInvitationSecret();
    expect(first.token).not.toBe(second.token);
    expect(isAdmissionToken(first.token)).toBe(true);
    const bytes = Uint8Array.from(atob(first.token.replaceAll('-', '+').replaceAll('_', '/')), (character) => character.charCodeAt(0));
    expect(bytes.length).toBe(32);
    const hash = await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(first.token));
    expect(first.tokenHash).toBe(Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join(''));
    const link = { eventId, inviteId, token: first.token };
    const url = new URL(invitationUrl('https://fictional.example.test/?discard=private#old', link));
    expect(url.search).toBe('');
    expect(url.hash).toContain('#join?event=');
    expect(url.href.split('#')[0]).not.toContain(first.token);
    expect(readInvitationFragment(url.hash)).toEqual(link);
    expect(readInvitationFragment(`${url.hash}&token=${first.token}`)).toBeUndefined();
    expect(readInvitationFragment(`#join?event=${eventId}&claim=${inviteId}`)).toBeUndefined();
    expect(readInvitationFragment('#join?malformed=%')).toBeUndefined();
    expect(() => invitationUrl('http://untrusted.example.test', link)).toThrow('secure');
    expect(() => invitationUrl('javascript:alert(1)', link)).toThrow('secure');
  });

  it('sends claims in an authenticated JSON body, never query parameters, cookies or persistence', async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(pending)));
    const client = createAdmissionsClient('https://fictional.example.test/api', () => Promise.resolve('fictional-token'), send);
    expect(await client.claim(eventId, { inviteId, token }, requestId, new AbortController().signal)).toEqual(pending);
    const [url, options] = send.mock.calls[0] ?? [];
    expect(url).toBe(`https://fictional.example.test/api/events/${eventId}/admissions/claim`);
    expect(options).toMatchObject({ method: 'POST', credentials: 'omit', cache: 'no-store', body: JSON.stringify({ inviteId, token }),
      headers: { Authorization: 'Bearer fictional-token', 'Idempotency-Key': requestId, 'Content-Type': 'application/json' } });
  });

  it('uses event preconditions and exact operation IDs for owner create, approve and security revoke', async () => {
    const send = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ operationId: requestId, inviteId, state: 'open' })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ operationId: requestId, inviteId, state: 'approved' })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ operationId: requestId, inviteId, state: 'revoked' })));
    const client = createAdmissionsClient('https://fictional.example.test/api', () => Promise.resolve('fictional'), send);
    const signal = new AbortController().signal;
    await client.invite(eventId, { inviteId, playerId: eventId, tokenHash: 'a'.repeat(64) }, 'v1', requestId, signal);
    await client.approve(eventId, { inviteId, revision: requestId, verificationCode: pending.verificationCode }, 'v2', requestId, signal);
    await client.revoke(eventId, { inviteId, revision: requestId }, 'v3', requestId, signal);
    expect(send.mock.calls.map(([, options]) => new Headers(options?.headers).get('If-Match'))).toEqual(['v1', 'v2', 'v3']);
    expect(send.mock.calls.map(([url]) => typeof url === 'string' ? url.split('/').at(-1) : undefined)).toEqual(['invite', 'approve', 'revoke']);
  });

  it('validates owner and caller-bound status results, rejects secret leaks and does not infer a grant from sign-in', async () => {
    const management = { eventId, eventStatus: 'active', etag: 'v1', roster: [], invitations: [], viewingPolicy: 'all-active-events' };
    const send = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify(management)))
      .mockResolvedValueOnce(new Response(JSON.stringify(pending)))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...management, tokenHash: 'a'.repeat(64) })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...pending, inviteId: eventId })));
    const client = createAdmissionsClient('https://fictional.example.test/api', () => Promise.resolve('fictional'), send);
    const signal = new AbortController().signal;
    expect(await client.list(eventId, signal)).toEqual(management);
    expect(await client.status(eventId, inviteId, signal)).toEqual(pending);
    expect(send.mock.calls[1]?.[0]).toBe(`https://fictional.example.test/api/events/${eventId}/admissions/status?inviteId=${inviteId}`);
    await expect(client.list(eventId, signal)).rejects.toThrow('Invalid');
    await expect(client.status(eventId, inviteId, signal)).rejects.toThrow('Invalid');
  });

  it('preserves failures and cancellation without false success or automatic approval retries', async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('{}', { status: 401 }))
      .mockResolvedValueOnce(new Response('{}', { status: 409 })).mockResolvedValueOnce(new Response('{}', { status: 503 }));
    const client = createAdmissionsClient('https://fictional.example.test/api', () => Promise.resolve('fictional'), send);
    const signal = new AbortController().signal;
    await expect(client.claim(eventId, { inviteId, token }, requestId, signal)).rejects.toBeInstanceOf(SessionExpiredError);
    await expect(client.claim(eventId, { inviteId, token }, requestId, signal)).rejects.toBeInstanceOf(EventChangedError);
    await expect(client.claim(eventId, { inviteId, token }, requestId, signal)).rejects.toThrow('503');
    await expect(client.invite(eventId, { inviteId, playerId: eventId, tokenHash: 'a'.repeat(64) }, '*', requestId, signal)).rejects.toThrow('Invalid');
    const controller = new AbortController();
    controller.abort();
    await expect(client.status(eventId, inviteId, controller.signal)).rejects.toThrow();
    expect(send).toHaveBeenCalledTimes(3);
  });
});
