import { describe, expect, it } from 'vitest';
import { readEventRoute, readPage } from './navigation';

describe('readPage', () => {
  it('keeps saved workspace and catalog deep links on Events without changing demo routes or callbacks', () => {
    expect(readPage('#events?catalog=courses')).toBe('events');
    expect(readPage('#events?event=fictional')).toBe('events');
    expect(readEventRoute('#events?catalog=courses')).toBe('courses');
    expect(readEventRoute('#events?catalog=players')).toBe('players');
    expect(readEventRoute('#events?event=fictional')).toBe('event:fictional');
    expect(readEventRoute('#events?catalog=unknown')).toBe('');
    expect(readEventRoute('#rounds?event=fictional')).toBe('');
  });
  it.each(['events', 'overview', 'rounds', 'group'] as const)('recognizes #%s', (page) => {
    expect(readPage(`#${page}`)).toBe(page);
  });

  it('routes identity callbacks to Events before MSAL consumes the authorization response', () => {
    expect(readPage('#code=fictional&state=fictional', '?event-auth=1')).toBe('events');
    expect(readPage('#error=access_denied', '?event-auth=1')).toBe('events');
    expect(readPage('', '?event-auth=1')).toBe('events');
    expect(readPage('#group', '?event-auth=1')).toBe('group');
    expect(readPage('#code=fictional')).toBe('overview');
  });

  it.each(['', '#', '#unknown', '#Rounds', '#rounds/1', '#%67roup'])('falls back safely for %j', (hash) => {
    expect(readPage(hash)).toBe('overview');
  });
});
