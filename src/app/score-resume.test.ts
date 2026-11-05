import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SavedScoreLocation } from '../domain/score-location';
import { clearScoreLocation, isSavedScoreLocation, loadScoreLocation, readScoreLocation, saveScoreLocation, scoreLocationHref } from './score-resume';

const key = 'perly-golf-max:last-score-location:v1';
const location: SavedScoreLocation = {
  version: 1, eventId: '00000000-0000-4000-8000-000000000001',
  roundId: '00000000-0000-4000-8000-000000000002', groupNumber: 52, holeNumber: 2, view: 'entry',
};
afterEach(() => { localStorage.clear(); vi.restoreAllMocks(); });

describe('navigation-only scoring recovery', () => {
  it('stores only navigation, restores across visits and explicitly clears it', () => {
    expect(loadScoreLocation()).toEqual({ location: null });
    expect(saveScoreLocation(location)).toBeNull();
    expect(JSON.parse(localStorage.getItem(key) ?? '')).toEqual(location);
    expect(loadScoreLocation()).toEqual({ location });
    expect(saveScoreLocation({ ...location, holeNumber: 18, view: 'cards' })).toBeNull();
    expect(loadScoreLocation().location?.holeNumber).toBe(18);
    expect(clearScoreLocation()).toBeNull();
    expect(loadScoreLocation()).toEqual({ location: null });
  });

  it.each([
    null, [], {}, { ...location, score: 4 }, { ...location, token: 'fictional-secret' },
    { ...location, version: 2 }, { ...location, eventId: 'not-an-id' },
    { ...location, roundId: '' }, { ...location, groupNumber: 0 },
    { ...location, groupNumber: Number.MAX_SAFE_INTEGER + 1 },
    { ...location, groupNumber: 1.5 }, { ...location, holeNumber: 0 },
    { ...location, holeNumber: 19 }, { ...location, view: 'admin' },
  ])('rejects invalid/extra payloads without replacing navigation (%j)', (value) => {
    expect(isSavedScoreLocation(value)).toBe(false);
    localStorage.setItem(key, JSON.stringify(value));
    expect(loadScoreLocation().location).toBeNull();
    expect(loadScoreLocation().error).toMatch(/could not be restored/);
  });

  it('rejects extra fields even on a typed value, leaving storage unchanged', () => {
    const withDraft = { ...location, drafts: [{ score: 4 }] };
    expect(saveScoreLocation(withDraft)).toEqual(expect.any(String));
    expect(localStorage.getItem(key)).toBeNull();
  });

  it.each(['{broken', ' '.repeat(1025), JSON.stringify({ ...location, view: 'x'.repeat(2000) })])('warns explicitly on corrupt or oversized storage', (text) => {
    localStorage.setItem(key, text);
    expect(loadScoreLocation().location).toBeNull();
    expect(loadScoreLocation().error).toMatch(/could not be restored/);
  });

  it('handles a denied default storage getter inside the guarded operation', () => {
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => { throw new Error('Storage denied'); });
    expect(loadScoreLocation().location).toBeNull();
    expect(loadScoreLocation().error).toMatch(/could not be restored/);
    expect(saveScoreLocation(location)).toMatch(/could not be stored/);
    expect(clearScoreLocation()).toMatch(/could not be cleared/);
    vi.restoreAllMocks();
  });

  it('warns when injected storage operations fail rather than claiming persistence', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Quota'); });
    expect(saveScoreLocation(location, localStorage)).toMatch(/could not be stored/);
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('Unavailable'); });
    expect(loadScoreLocation(localStorage).error).toMatch(/could not be restored/);
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('Denied'); });
    expect(clearScoreLocation(localStorage)).toMatch(/could not be cleared/);
  });

  it.each(['entry', 'cards', 'games', 'leaderboard'] as const)('round-trips an explicit %s deep link without scores or credentials', (view) => {
    const value = { ...location, view };
    expect(scoreLocationHref(value)).toBe(`#events?event=${value.eventId}&round=${value.roundId}&group=52&hole=2&view=${view}`);
    expect(readScoreLocation(scoreLocationHref(value))).toEqual(value);
  });

  it.each([
    '#events', '#overview?', '#events?event=x', `${scoreLocationHref(location)}&token=x`,
    `${scoreLocationHref(location)}&hole=3`, scoreLocationHref(location).replace('hole=2', 'hole=02'),
    scoreLocationHref(location).replace('hole=2', 'hole=2.0'),
    scoreLocationHref(location).replace('hole=2', 'hole=19'),
    scoreLocationHref(location).replace('group=52', 'group=9007199254740992'),
    scoreLocationHref(location).replace('view=entry', 'view=unknown'),
    scoreLocationHref(location).replace('event=00000000', 'event=invalid'),
    '#events?' + 'x'.repeat(1024),
  ])('rejects malformed or ambiguous navigation %s', (hash) => {
    expect(readScoreLocation(hash)).toBeNull();
  });
});
