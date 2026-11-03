import { describe, expect, it } from 'vitest';
import { isEventCapabilities, isEventSummary, readEventName } from './events';

describe('event contracts', () => {
  it('accepts a bounded trimmed name, not client-supplied ownership', () => {
    expect(readEventName({ name: '  Fictional Open  ', owner: 'untrusted' })).toBe('Fictional Open');
  });

  it.each([null, [], {}, { name: '' }, { name: '  ' }, { name: 'x'.repeat(101) }])('rejects invalid input %j', (value) => {
    expect(readEventName(value)).toBeUndefined();
  });

  it('validates capabilities and complete event summaries at the network boundary', () => {
    const event = { id: '00000000-0000-4000-8000-000000000001', name: 'Fictional Open', createdAt: '2026-01-01T00:00:00Z', role: 'owner' };
    expect(isEventSummary(event)).toBe(true);
    expect(isEventSummary({ ...event, role: 'admin' })).toBe(false);
    expect(isEventSummary({ ...event, createdAt: 'tomorrow' })).toBe(false);
    expect(isEventCapabilities({ canCreateEvents: true })).toBe(true);
    expect(isEventCapabilities({ canCreateEvents: 'true' })).toBe(false);
  });
});
