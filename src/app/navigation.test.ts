import { describe, expect, it } from 'vitest';
import { eventTabHref, readEventRoute, readPage, readPreviewTab, readSelectedEvent } from './navigation';

describe('readPage', () => {
  it('keeps purse routes event-scoped and rejects missing, repeated and malformed context', () => {
    const event = '00000000-0000-4000-8000-000000000050';
    const hash = `#purse?event=${event}`;
    expect(readPage(hash)).toBe('purse');
    expect(readSelectedEvent(hash)).toBe(event);
    expect(readEventRoute(hash)).toBe(`purse:${event}`);
    for (const invalid of ['#purse', '#purse?event=bad', `${hash}&event=${event}`]) {
      expect(readEventRoute(invalid)).toBe('invalid-event');
    }
    expect(readEventRoute(`${hash}&round=${event}`)).toBe('invalid-score');
    expect(readEventRoute(`#preview?event=${event}&view=purse`)).toBe('');
  });
  it('keeps overall standings event-scoped with refresh-safe links, never an anonymous or Preview board', () => {
    const event = '00000000-0000-4000-8000-000000000050';
    const hash = `#leaderboard?event=${event}`;
    expect(readPage(hash)).toBe('leaderboard');
    expect(readSelectedEvent(hash)).toBe(event);
    expect(readEventRoute(hash)).toBe(`leaderboard:${event}`);
    for (const invalid of ['#leaderboard', '#leaderboard?event=bad', `${hash}&event=${event}`]) {
      expect(readEventRoute(invalid)).toBe('invalid-event');
    }
    expect(readEventRoute(`${hash}&round=${event}`)).toBe('invalid-score');
    expect(readEventRoute(`#preview?event=${event}&view=leaderboard`)).toBe('');
  });
  it('validates both identifiers for refresh-safe score routes before issuing requests', () => {
    const event = '00000000-0000-4000-8000-000000000050';
    const round = '00000000-0000-4000-8000-000000000070';
    expect(readEventRoute(`#events?event=${event}&round=${round}`)).toBe(`score:${event}:${round}`);
    expect(readPage(`#events?event=${event}&round=${round}`)).toBe('events');
    for (const hash of [`#events?event=bad&round=${round}`, `#events?event=${event}&round=bad`, `#events?round=${round}`, `#events?event=${event}&round=`]) {
      expect(readEventRoute(hash)).toBe('invalid-score');
    }
  });
  it('preserves setup/catalog routes and rejects malformed selected-event routes', () => {
    expect(readPage('#events?catalog=courses')).toBe('events');
    expect(readPage('#events?event=fictional')).toBe('events');
    expect(readEventRoute('#events?catalog=courses')).toBe('courses');
    expect(readEventRoute('#events?catalog=players')).toBe('players');
    expect(readEventRoute('#events?event=fictional')).toBe('invalid-event');
    expect(readEventRoute('#events?catalog=unknown')).toBe('');
    expect(readEventRoute('#rounds?event=fictional')).toBe('invalid-event');
  });
  it.each(['events', 'overview', 'rounds', 'group', 'preview'] as const)('recognizes #%s', (page) => {
    expect(readPage(`#${page}`)).toBe(page);
  });

  it('routes identity callbacks to Events before MSAL consumes the authorization response', () => {
    expect(readPage('#code=fictional&state=fictional', '?event-auth=1')).toBe('events');
    expect(readPage('#error=access_denied', '?event-auth=1')).toBe('events');
    expect(readPage('', '?event-auth=1')).toBe('events');
    expect(readPage('#group', '?event-auth=1')).toBe('group');
    expect(readPage('#code=fictional')).toBe('events');
  });

  it.each(['', '#', '#unknown', '#Rounds', '#rounds/1', '#%67roup'])('falls back safely for %j', (hash) => {
    expect(readPage(hash)).toBe('events');
  });
  it('keeps explicit live event context in each tab and never treats Preview as a selected event', () => {
    const event = '00000000-0000-4000-8000-000000000050';
    for (const tab of ['overview', 'rounds', 'group'] as const) {
      expect(readEventRoute(eventTabHref(tab, event))).toBe(`${tab}:${event}`);
      expect(readSelectedEvent(eventTabHref(tab, event))).toBe(event);
      expect(readEventRoute(eventTabHref(tab, null))).toBe(`select:${tab}`);
    }
    expect(readEventRoute(`#events?event=${event}`)).toBe(`event:${event}`);
    expect(readSelectedEvent(`#events?event=${event}&event=${event}`)).toBeNull();
    expect(readEventRoute(`#overview?event=${event}&event=${event}`)).toBe('invalid-event');
    expect(readSelectedEvent(`#preview?event=${event}`)).toBeNull();
    expect(readEventRoute(`#preview?event=${event}`)).toBe('');
    expect(readEventRoute('#group?event=')).toBe('invalid-event');
  });
  it('names demo destinations only inside the explicit Preview route', () => {
    expect(readPreviewTab('#preview')).toBe('overview');
    expect(readPreviewTab('#preview?view=rounds')).toBe('rounds');
    expect(readPreviewTab('#preview?view=group')).toBe('group');
    expect(readPreviewTab('#preview?view=unsupported')).toBe('overview');
  });
});
