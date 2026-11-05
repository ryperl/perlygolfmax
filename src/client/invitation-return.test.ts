import { beforeEach, describe, expect, it } from 'vitest';
import { clearInvitationReturn, consumeInvitationReturn, rememberInvitationReturn, validInvitationRoute } from './invitation-return';

const event = '00000000-0000-4000-8000-000000000001';
const invite = '00000000-0000-4000-8000-000000000002';
const raw = `#join?event=${event}&invite=${invite}&token=${'A'.repeat(43)}`;
beforeEach(() => { sessionStorage.clear(); });
describe('bounded private invitation continuation', () => {
  it('keeps only a validated relative invitation during sign-in and consumes it once', () => {
    rememberInvitationReturn(raw, sessionStorage, 1000);
    expect(consumeInvitationReturn(sessionStorage, 1001)).toBe(raw);
    expect(consumeInvitationReturn(sessionStorage, 1002)).toBeNull();
    const claimed = `#join?event=${event}&claim=${invite}`;
    expect(validInvitationRoute(claimed)).toBe(true);
    rememberInvitationReturn(claimed, sessionStorage, 1000);
    clearInvitationReturn();
    expect(consumeInvitationReturn(sessionStorage, 1001)).toBeNull();
  });
  it('rejects duplicate/foreign/invalid routes and expires the short-lived continuation', () => {
    for (const hash of [
      'https://not-allowed.invalid/#join', '#events', `${raw}&event=${event}`,
      `${raw}&redirect=https://not-allowed.invalid`, raw.replace(event, 'bad'),
      `#join?event=${event}&invite=${invite}&token=short`,
      `#join?event=${event}&claim=${invite}&token=${'A'.repeat(43)}`,
    ]) {
      expect(validInvitationRoute(hash)).toBe(false);
      rememberInvitationReturn(hash, sessionStorage, 1000);
      expect(consumeInvitationReturn(sessionStorage, 1001)).toBeNull();
    }
    rememberInvitationReturn(raw, sessionStorage, 1000);
    expect(consumeInvitationReturn(sessionStorage, 1000 + 30 * 60 * 1000)).toBeNull();
  });
  it('does not silently succeed when browser storage is unavailable', () => {
    const storage: Storage = { length: 0, clear: () => undefined, key: () => null,
      getItem: () => { throw new Error('Storage unavailable'); },
      setItem: () => { throw new Error('Storage unavailable'); }, removeItem: () => { throw new Error('Storage unavailable'); } };
    expect(() => { rememberInvitationReturn(raw, storage); }).toThrow('Storage unavailable');
    expect(() => consumeInvitationReturn(storage)).toThrow('Storage unavailable');
    expect(() => { clearInvitationReturn(storage); }).toThrow('Storage unavailable');
  });
});
