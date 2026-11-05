import { describe, expect, it, vi } from 'vitest';
import { createPurseClient } from './purse';
import { fictionalEventPurse, fictionalPurseWrite } from './purse.test-support';
import { fictionalId } from './catalog.test-support';
import { isEventPurseView, isPurseWriteResult } from '../contracts/purse-settings';

describe('typed private purse client', () => {
  it('loads a complete validated owner view without cookies or cache', async () => {
    const value = fictionalEventPurse();
    expect(isEventPurseView(value)).toBe(true);
    const send = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(value)));
    const client = createPurseClient('https://fictional.example.test/api', () => Promise.resolve('fictional-token'), send);
    const signal = new AbortController().signal;
    expect(await client.load(value.workspace.event.id, signal)).toEqual(value);
    expect(send.mock.calls[0]).toEqual([
      `https://fictional.example.test/api/events/${value.workspace.event.id}/purse`,
      expect.objectContaining({ signal, cache: 'no-store', credentials: 'omit', headers: { Authorization: 'Bearer fictional-token' } }),
    ]);
  });
  it('uses exact conditional/idempotent saves and rejects a different acknowledgement or altered winnings', async () => {
    const before = fictionalEventPurse();
    const plan = before.configuration.plan;
    if (!plan) throw new Error('Missing fictional plan.');
    const requestId = fictionalId(950);
    const result = fictionalPurseWrite(before, plan, [], before.configuration.etag, requestId);
    expect(isPurseWriteResult(result)).toBe(true);
    const send = vi.fn<typeof fetch>().mockImplementation(() => Promise.resolve(new Response(JSON.stringify(result))));
    const client = createPurseClient('https://fictional.example.test/api', () => Promise.resolve('fictional'), send);
    const signal = new AbortController().signal;
    expect(await client.save(plan.eventId, plan, [], before.configuration.etag, requestId, signal)).toEqual(result);
    expect(send.mock.calls[0]?.[1]).toMatchObject({
      method: 'PUT', body: JSON.stringify({ plan, resolutions: [] }),
      headers: { 'If-Match': before.configuration.etag, 'Idempotency-Key': requestId },
    });
    send.mockResolvedValueOnce(new Response(JSON.stringify({ ...result, change: { ...result.change, id: fictionalId(951) } })));
    await expect(client.save(plan.eventId, plan, [], before.configuration.etag, requestId, signal)).rejects.toThrow('acknowledgement');
    const view = result.current.view;
    if (!view) throw new Error('Missing fictional calculation.');
    send.mockResolvedValueOnce(new Response(JSON.stringify({
      ...result.current, view: { ...view, calculation: { ...view.calculation, allocatedMinor: 9999 } },
    })));
    await expect(client.load(plan.eventId, signal)).rejects.toThrow('response');
  });
  it('validates input before token acquisition and cancels without sending', async () => {
    const value = fictionalEventPurse();
    const plan = value.configuration.plan;
    if (!plan) throw new Error('Missing fictional plan.');
    const token = vi.fn().mockResolvedValue('fictional');
    const send = vi.fn<typeof fetch>();
    const client = createPurseClient('https://fictional.example.test/api', token, send);
    const signal = new AbortController().signal;
    await expect(client.load('bad', signal)).rejects.toThrow('identifier');
    await expect(client.save(plan.eventId, { ...plan, eventId: fictionalId(999) }, [], null, fictionalId(950), signal)).rejects.toThrow('plan');
    await expect(client.save(plan.eventId, { ...plan, funding: { kind: 'fixed', budgetMinor: -1 } }, [], null, fictionalId(950), signal)).rejects.toThrow('plan');
    const aborted = new AbortController();
    aborted.abort();
    await expect(client.load(plan.eventId, aborted.signal)).rejects.toThrow();
    expect(token).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });
});
