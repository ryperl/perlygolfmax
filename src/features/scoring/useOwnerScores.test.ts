import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SessionExpiredError } from '../../client/events';
import { PrivateRequestError } from '../../client/private-request';
import { fakeScores, fictionalRoundScores, scoreResult } from '../../client/scoring.test-support';
import type { RoundScores } from '../../domain/scoring';
import { useOwnerScores } from './useOwnerScores';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { resolve, promise };
}
async function advance(ms: number) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('foreground owner score polling', () => {
  it('restarts its aborted activation immediately under the application StrictMode without waiting for a poll', async () => {
    const client = fakeScores();
    const discarded = deferred<RoundScores>();
    vi.mocked(client.load).mockReturnValueOnce(discarded.promise).mockResolvedValueOnce(fictionalRoundScores);
    const { result } = renderHook(() => useOwnerScores(client, fictionalRoundScores.eventId, fictionalRoundScores.roundId, false, vi.fn()), {
      reactStrictMode: true,
    });
    await act(async () => { await Promise.resolve(); });
    expect(client.load).toHaveBeenCalledTimes(2);
    expect(vi.mocked(client.load).mock.calls[0]?.[2].aborted).toBe(true);
    expect(result.current.busy).toBe(false);
    expect(result.current.round).toEqual(fictionalRoundScores);
    await act(async () => { discarded.resolve(scoreResult().round); await discarded.promise; });
    expect(result.current.round).toEqual(fictionalRoundScores);
  });
  it('never overlaps an initial or polling read, then accepts persisted owner activity', async () => {
    vi.useFakeTimers();
    const client = fakeScores();
    const first = deferred<RoundScores>();
    const second = deferred<RoundScores>();
    vi.mocked(client.load).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { result, unmount } = renderHook(() => useOwnerScores(client, fictionalRoundScores.eventId, fictionalRoundScores.roundId, false, vi.fn()));
    await advance(60_000);
    expect(client.load).toHaveBeenCalledOnce();
    await act(async () => { first.resolve(fictionalRoundScores); await first.promise; });
    expect(result.current.round).toEqual(fictionalRoundScores);
    await advance(15_000);
    expect(client.load).toHaveBeenCalledTimes(2);
    await advance(60_000);
    expect(client.load).toHaveBeenCalledTimes(2);
    await act(async () => { second.resolve(scoreResult().round); await second.promise; });
    expect(result.current.round).toEqual(scoreResult().round);
    expect(result.current.stale).toBe(false);
    expect(result.current.refreshedAt).not.toBeNull();
    unmount();
  });
  it('serializes both read-before-write and write-before-read completion orders without an older projection overwriting an ack', async () => {
    vi.useFakeTimers();
    const client = fakeScores();
    const initial = deferred<RoundScores>();
    vi.mocked(client.load).mockReturnValueOnce(initial.promise);
    const { result } = renderHook(() => useOwnerScores(client, fictionalRoundScores.eventId, fictionalRoundScores.roundId, false, vi.fn()));
    const write = vi.fn().mockResolvedValue(scoreResult().round);
    await act(async () => { expect(await result.current.run(write)).toBeNull(); });
    expect(write).not.toHaveBeenCalled();
    await act(async () => { initial.resolve(fictionalRoundScores); await initial.promise; });
    const pending = deferred<RoundScores>();
    let operation: Promise<RoundScores | null> | undefined;
    act(() => { operation = result.current.run(() => pending.promise); });
    await advance(45_000);
    expect(client.load).toHaveBeenCalledOnce();
    await act(async () => { expect(await result.current.refresh()).toBeNull(); });
    await act(async () => {
      pending.resolve(scoreResult().round);
      const saved = await operation;
      if (saved) result.current.accept(saved);
    });
    expect(result.current.round).toEqual(scoreResult().round);
  });
  it('pauses hidden/dirty screens, permits manual dirty refresh, and aborts unmount without restoring late private data', async () => {
    vi.useFakeTimers();
    const client = fakeScores();
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    const { result, rerender, unmount } = renderHook(({ dirty }) => useOwnerScores(client, fictionalRoundScores.eventId, fictionalRoundScores.roundId, dirty, vi.fn()), { initialProps: { dirty: false } });
    await act(async () => { await Promise.resolve(); });
    hidden.mockReturnValue(true);
    await advance(45_000);
    expect(client.load).toHaveBeenCalledOnce();
    hidden.mockReturnValue(false);
    rerender({ dirty: true });
    await advance(45_000);
    expect(client.load).toHaveBeenCalledOnce();
    await act(async () => { await result.current.refresh(); });
    expect(client.load).toHaveBeenCalledTimes(2);
    const pending = deferred<RoundScores>();
    vi.mocked(client.load).mockReturnValueOnce(pending.promise);
    rerender({ dirty: false });
    await advance(15_000);
    const signal = vi.mocked(client.load).mock.calls.at(-1)?.[2];
    unmount();
    expect(signal?.aborted).toBe(true);
    await act(async () => { pending.resolve(scoreResult().round); await pending.promise; });
    await advance(120_000);
    expect(client.load).toHaveBeenCalledTimes(3);
  });
  it.each(['Too many requests (429).', 'Network unavailable.', 'Service request failed (503).'])('marks stale, backs off and recovers after %s', async (message) => {
    vi.useFakeTimers();
    const client = fakeScores();
    vi.mocked(client.load).mockRejectedValueOnce(new Error(message)).mockResolvedValueOnce(scoreResult().round);
    const { result } = renderHook(() => useOwnerScores(client, fictionalRoundScores.eventId, fictionalRoundScores.roundId, false, vi.fn()));
    await act(async () => { await Promise.resolve(); });
    expect(result.current.error).toContain(message);
    expect(result.current.stale).toBe(true);
    await advance(15_000);
    expect(client.load).toHaveBeenCalledOnce();
    await advance(15_000);
    expect(client.load).toHaveBeenCalledTimes(2);
    expect(result.current.error).toBe('');
    expect(result.current.stale).toBe(false);
    vi.mocked(client.load).mockRejectedValueOnce(new Error(message));
    await advance(15_000);
    expect(client.load).toHaveBeenCalledTimes(3);
    expect(result.current.stale).toBe(true);
    expect(result.current.round).toEqual(scoreResult().round);
    await advance(15_000);
    expect(client.load).toHaveBeenCalledTimes(3);
    await advance(15_000);
    expect(client.load).toHaveBeenCalledTimes(4);
    expect(result.current.stale).toBe(false);
  });
  it('stops polling an expired session and clears previously loaded private cards', async () => {
    vi.useFakeTimers();
    const client = fakeScores();
    const expired = vi.fn();
    const { result } = renderHook(() => useOwnerScores(client, fictionalRoundScores.eventId, fictionalRoundScores.roundId, false, expired));
    await act(async () => { await Promise.resolve(); });
    vi.mocked(client.load).mockRejectedValueOnce(new SessionExpiredError('Sign in again.'));
    await advance(15_000);
    expect(expired).toHaveBeenCalledWith('Sign in again.');
    expect(result.current.round).toBeNull();
    await advance(120_000);
    expect(client.load).toHaveBeenCalledTimes(2);
  });
  it('removes previously loaded private cards on authoritative permission revocation and requires manual recovery', async () => {
    vi.useFakeTimers();
    const client = fakeScores();
    const { result } = renderHook(() => useOwnerScores(client, fictionalRoundScores.eventId, fictionalRoundScores.roundId, false, vi.fn()));
    await act(async () => { await Promise.resolve(); });
    expect(result.current.round).not.toBeNull();
    vi.mocked(client.load).mockRejectedValueOnce(new PrivateRequestError(403, 'Owner access denied.'));
    await advance(15_000);
    expect(result.current.round).toBeNull();
    await advance(120_000);
    expect(client.load).toHaveBeenCalledTimes(2);
    await act(async () => { await result.current.refresh(); });
    expect(result.current.round).not.toBeNull();
  });
  it('respects the API 60-second minimum for 429, including an explicit retry, then recovers', async () => {
    vi.useFakeTimers();
    const client = fakeScores();
    vi.mocked(client.load).mockRejectedValueOnce(new PrivateRequestError(429, 'Too many requests.'));
    const { result } = renderHook(() => useOwnerScores(client, fictionalRoundScores.eventId, fictionalRoundScores.roundId, false, vi.fn()));
    await act(async () => { await Promise.resolve(); });
    expect(result.current.error).toContain('Wait at least 60 seconds');
    await advance(30_000);
    expect(client.load).toHaveBeenCalledOnce();
    await act(async () => { expect(await result.current.refresh()).toBeNull(); });
    expect(client.load).toHaveBeenCalledOnce();
    await advance(29_999);
    expect(client.load).toHaveBeenCalledOnce();
    await advance(1);
    expect(client.load).toHaveBeenCalledTimes(2);
    expect(result.current.error).toBe('');
    expect(result.current.stale).toBe(false);
  });
  it('uses the greater of exponential backoff and each bounded server minimum', async () => {
    vi.useFakeTimers();
    const client = fakeScores();
    vi.mocked(client.load).mockRejectedValueOnce(new PrivateRequestError(503, 'Unavailable.', 90))
      .mockRejectedValueOnce(new PrivateRequestError(429, 'Limited.', 20));
    const { result } = renderHook(() => useOwnerScores(client, fictionalRoundScores.eventId, fictionalRoundScores.roundId, false, vi.fn()));
    await act(async () => { await Promise.resolve(); });
    await advance(89_999);
    expect(client.load).toHaveBeenCalledOnce();
    await advance(1);
    expect(client.load).toHaveBeenCalledTimes(2);
    await advance(59_999);
    expect(client.load).toHaveBeenCalledTimes(2);
    await advance(1);
    expect(client.load).toHaveBeenCalledTimes(3);
    expect(result.current.stale).toBe(false);
  });
});
