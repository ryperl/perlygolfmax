import { describe, expect, it } from 'vitest';
import { readPage } from './navigation';

describe('readPage', () => {
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
