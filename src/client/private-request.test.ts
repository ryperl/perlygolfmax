import { describe, expect, it, vi } from 'vitest';
import { createPrivateRequest } from './private-request';

describe('private catalog/setup transport', () => {
  it('bounds actual UTF-8 bytes before acquiring a token or sending a write', async () => {
    const send = vi.fn<typeof fetch>();
    const token = vi.fn().mockResolvedValue('fictional');
    const request = createPrivateRequest('https://fictional.example.test/api', token, send);
    await expect(request('catalog/players', new AbortController().signal, {
      method: 'POST', body: { displayName: '界'.repeat(1400) },
    })).rejects.toThrow('4096-byte UTF-8');
    expect(send).not.toHaveBeenCalled();
    expect(token).not.toHaveBeenCalled();
  });
  it('accepts a bounded write and returns unknown JSON for the caller to validate', async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(new Response('{"ok":true}'));
    const request = createPrivateRequest('https://fictional.example.test/api', () => Promise.resolve('fictional'), send);
    await expect(request('catalog/players', new AbortController().signal, { method: 'POST', body: { displayName: 'Fictional' } })).resolves.toEqual({ ok: true });
    expect(send.mock.calls[0]?.[1]).toMatchObject({ cache: 'no-store', credentials: 'omit' });
  });
});
