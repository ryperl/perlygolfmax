import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SessionExpiredError } from '../../client/events';
import { PrivateRequestError } from '../../client/private-request';
import { fakeScores, fictionalRoundScores, scoreResult } from '../../client/scoring.test-support';
import type { RoundScores } from '../../domain/scoring';
import { useOwnerScores } from './useOwnerScores';

function deferred<T>() {
  let resolve: ((value: T) => void) | undefined;
  let reject: ((reason: unknown) => void) | undefined;
  const promise = new Promise<T>((complete, fail) => { resolve = complete; reject = fail; });
  return {
    resolve(value: T) { if (!resolve) throw new Error('Uninitialized fictional response'); resolve(value); },
    reject(reason: unknown) { if (!reject) throw new Error('Uninitialized fictional response'); reject(reason); },
    promise,
  };
}
async function advance(ms: number) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('foreground owner score polling', () => {
  it('keeps polling out of foreground busy state and retains the exact unchanged projection, but exposes actual changes', async () => {
    vi.useFakeTimers();
    const client = fakeScores();
    const poll = deferred<RoundScores>();
    vi.mocked(client.load).mockResolvedValueOnce(fictionalRoundScores).mockReturnValueOnce(poll.promise);
    const { result } = renderHook(() => useOwnerScores(client, fictionalRoundScores.eventId, fictionalRoundScores.roundId, false, vi.fn()));
    await act(async () => { await Promise.resolve(); });
    const first = result.current.round;
    await advance(15_000);
    expect(result.current.busy).toBe(false);
    expect(result.current.stale).toBe(false);
    await act(async () => { poll.resolve(structuredClone(fictionalRoundScores)); await poll.promise; });
    expect(result.current.round).toBe(first);
    expect(result.current.busy).toBe(false);
    vi.mocked(client.load).mockResolvedValueOnce(scoreResult().round);
    await advance(15_000);
    expect(result.current.round).toEqual(scoreResult().round);
    expect(result.current.round).not.toBe(first);
    expect(result.current.busy).toBe(false);
  });
  it('preserves the edit-time projection if editing begins during a poll and requires refresh to review newly detected data', async () => {
    vi.useFakeTimers();
    const client = fakeScores();
    const poll = deferred<RoundScores>();
    vi.mocked(client.load).mockResolvedValueOnce(fictionalRoundScores).mockReturnValueOnce(poll.promise);
    const { result, rerender } = renderHook(({ dirty }) => useOwnerScores(client, fictionalRoundScores.eventId, fictionalRoundScores.roundId, dirty, vi.fn()), { initialProps: { dirty: false } });
    await act(async () => { await Promise.resolve(); });
    await advance(15_000);
    act(() => { result.current.pauseForEdit(); });
    rerender({ dirty: true });
    await act(async () => { poll.resolve(scoreResult().round); await poll.promise; });
    expect(result.current.round).toBe(fictionalRoundScores);
    expect(result.current.stale).toBe(true);
    expect(result.current.busy).toBe(false);
    await advance(60_000);
    expect(client.load).toHaveBeenCalledTimes(2);
    vi.mocked(client.load).mockResolvedValueOnce(scoreResult().round);
    await act(async () => { await result.current.refresh(); });
    expect(result.current.round).toEqual(scoreResult().round);
    expect(result.current.stale).toBe(false);
  });
  it('queues a foreground mutation behind a poll without overlap or accepting its superseded projection', async () => {
    vi.useFakeTimers();
    const client = fakeScores();
    const poll = deferred<RoundScores>();
    const mutation = deferred<string>();
    vi.mocked(client.load).mockResolvedValueOnce(fictionalRoundScores).mockReturnValueOnce(poll.promise);
    const { result } = renderHook(() => useOwnerScores(client, fictionalRoundScores.eventId, fictionalRoundScores.roundId, false, vi.fn()));
    await act(async () => { await Promise.resolve(); });
    await advance(15_000);
    const write = vi.fn().mockReturnValue(mutation.promise);
    let operation: Promise<string | null> | undefined;
    act(() => { operation = result.current.run(write); });
    expect(result.current.busy).toBe(true);
    expect(write).not.toHaveBeenCalled();
    await act(async () => { expect(await result.current.run(write)).toBeNull(); });
    await act(async () => { poll.resolve(scoreResult().round); await poll.promise; });
    expect(write).toHaveBeenCalledOnce();
    expect(result.current.round).toBe(fictionalRoundScores);
    expect(result.current.busy).toBe(true);
    await advance(60_000);
    expect(client.load).toHaveBeenCalledTimes(2);
    await act(async () => { mutation.resolve('acknowledged'); await operation; result.current.accept(scoreResult().round); });
    expect(result.current.busy).toBe(false);
    expect(result.current.round).toEqual(scoreResult().round);
  });
  it.each([
    new PrivateRequestError(403, 'Owner revoked.'),
    new PrivateRequestError(404, 'Round unavailable.'),
    new SessionExpiredError('Sign in again.'),
  ])('does not hide authoritative background errors or execute a queued save after %s', async (failure) => {
    vi.useFakeTimers();
    const client = fakeScores();
    const poll = deferred<RoundScores>();
    const expired = vi.fn();
    vi.mocked(client.load).mockResolvedValueOnce(fictionalRoundScores).mockReturnValueOnce(poll.promise);
    const { result } = renderHook(() => useOwnerScores(client, fictionalRoundScores.eventId, fictionalRoundScores.roundId, false, expired));
    await act(async () => { await Promise.resolve(); });
    await advance(15_000);
    act(() => { result.current.pauseForEdit(); });
    const write = vi.fn().mockResolvedValue('should not execute');
    let operation: Promise<string | null> | undefined;
    act(() => { operation = result.current.run(write); });
    await act(async () => { poll.reject(failure); expect(await operation).toBeNull(); });
    expect(write).not.toHaveBeenCalled();
    expect(result.current.round).toBeNull();
    expect(result.current.error).toContain(failure.message);
    expect(result.current.busy).toBe(false);
    if (failure instanceof SessionExpiredError) expect(expired).toHaveBeenCalledWith(failure.message);
  });
  it('surfaces background network failure, backs off and recovers without replacing identical saved data', async () => {
    vi.useFakeTimers();
    const client = fakeScores();
    const poll = deferred<RoundScores>();
    vi.mocked(client.load).mockResolvedValueOnce(fictionalRoundScores).mockReturnValueOnce(poll.promise)
      .mockResolvedValueOnce(structuredClone(fictionalRoundScores));
    const { result } = renderHook(() => useOwnerScores(client, fictionalRoundScores.eventId, fictionalRoundScores.roundId, false, vi.fn()));
    await act(async () => { await Promise.resolve(); });
    await advance(15_000);
    expect(result.current.busy).toBe(false);
    await act(async () => { poll.reject(new Error('Poll connection failed.')); await Promise.resolve(); });
    expect(result.current.error).toContain('Poll connection failed');
    expect(result.current.round).toBe(fictionalRoundScores);
    expect(result.current.stale).toBe(true);
    await advance(29_999);
    expect(client.load).toHaveBeenCalledTimes(2);
    await advance(1);
    expect(client.load).toHaveBeenCalledTimes(3);
    expect(result.current.error).toBe('');
    expect(result.current.stale).toBe(false);
    expect(result.current.round).toBe(fictionalRoundScores);
  });
  it('unblocks and cancels a queued foreground operation on unmount without restoring a late poll', async () => {
    vi.useFakeTimers();
    const client = fakeScores();
    const poll = deferred<RoundScores>();
    vi.mocked(client.load).mockResolvedValueOnce(fictionalRoundScores).mockReturnValueOnce(poll.promise);
    const { result, unmount } = renderHook(() => useOwnerScores(client, fictionalRoundScores.eventId, fictionalRoundScores.roundId, false, vi.fn()));
    await act(async () => { await Promise.resolve(); });
    await advance(15_000);
    const write = vi.fn().mockResolvedValue('should not execute');
    let operation: Promise<string | null> | undefined;
    act(() => { operation = result.current.run(write); });
    const signal = vi.mocked(client.load).mock.calls[1]?.[2];
    unmount();
    expect(signal?.aborted).toBe(true);
    expect(await operation).toBeNull();
    await act(async () => { poll.resolve(scoreResult().round); await poll.promise; });
    expect(write).not.toHaveBeenCalled();
  });
  it('respects a background Retry-After before admitting a queued foreground mutation', async () => {
    vi.useFakeTimers();
    const client = fakeScores();
    const poll = deferred<RoundScores>();
    vi.mocked(client.load).mockResolvedValueOnce(fictionalRoundScores).mockReturnValueOnce(poll.promise);
    const { result } = renderHook(() => useOwnerScores(client, fictionalRoundScores.eventId, fictionalRoundScores.roundId, false, vi.fn()));
    await act(async () => { await Promise.resolve(); });
    await advance(15_000);
    const write = vi.fn().mockResolvedValue('acknowledged');
    let operation: Promise<string | null> | undefined;
    act(() => { operation = result.current.run(write); });
    await act(async () => { poll.reject(new PrivateRequestError(429, 'Poll quota reached.', 60)); expect(await operation).toBeNull(); });
    expect(result.current.error).toContain('Wait at least 60 seconds');
    expect(result.current.busy).toBe(false);
    expect(write).not.toHaveBeenCalled();
    await advance(59_999);
    await act(async () => { expect(await result.current.run(write)).toBeNull(); });
    expect(client.load).toHaveBeenCalledTimes(2);
    await advance(1);
    await act(async () => { expect(await result.current.run(write)).toBe('acknowledged'); });
    expect(write).toHaveBeenCalledOnce();
  });
  it('keeps manual refresh foreground loading and its errors visible', async () => {
    const client = fakeScores();
    const manual = deferred<RoundScores>();
    vi.mocked(client.load).mockResolvedValueOnce(fictionalRoundScores).mockReturnValueOnce(manual.promise);
    const { result } = renderHook(() => useOwnerScores(client, fictionalRoundScores.eventId, fictionalRoundScores.roundId, false, vi.fn()));
    await act(async () => { await Promise.resolve(); });
    let operation: Promise<RoundScores | null> | undefined;
    act(() => { operation = result.current.refresh(); });
    expect(result.current.busy).toBe(true);
    await act(async () => { manual.reject(new Error('Explicit refresh failed.')); await operation?.catch(() => undefined); });
    expect(result.current.busy).toBe(false);
    expect(result.current.error).toContain('Explicit refresh failed');
    expect(result.current.stale).toBe(true);
    expect(result.current.round).toBe(fictionalRoundScores);
  });
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
