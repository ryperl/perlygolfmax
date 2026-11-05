import { describe, expect, it } from 'vitest';
import { isIndexRefreshAudit } from './index-refresh.js';
import { identifier } from '../../test/catalog-fixtures.js';
import { creator, event } from '../../test/fixtures.js';

describe('captured-index refresh audit roster', () => {
  it.each([1, 2, 3])('accepts %i captured golfers and rejects empty, duplicate or mismatched counterparts', (count) => {
    const inputs = Array.from({ length: count }, (_, index) => ({ playerId: identifier(200 + index), handicapIndex: null }));
    const audit = { eventId: event.id, roundId: identifier(500), requestId: identifier(600),
      expectedEtag: 'fictional-etag', recordedAt: '2026-01-01T00:00:00Z', recordedBy: creator,
      previous: inputs, updated: inputs };
    expect(isIndexRefreshAudit(audit)).toBe(true);
    expect(isIndexRefreshAudit({ ...audit, previous: [], updated: [] })).toBe(false);
    expect(isIndexRefreshAudit({ ...audit, previous: [...inputs, ...inputs], updated: [...inputs, ...inputs] })).toBe(false);
    expect(isIndexRefreshAudit({ ...audit, updated: inputs.map((entry) => ({ ...entry, playerId: identifier(999) })) })).toBe(false);
  });
});
