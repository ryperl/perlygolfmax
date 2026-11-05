import { describe, expect, it } from 'vitest';
import { isPublicBrowseIdentity, isPublicScoreIdentity } from './public-access.js';
import { isScoreActor } from './scoring.js';
import { sameScoreActor, scoreActor } from '../domain/scoring.js';

const eventId = '00000000-0000-4000-8000-000000000001';
const otherId = '00000000-0000-4000-8000-000000000002';

describe('explicit unverified public principals', () => {
  it('accepts only exact own fields and never account, link or person claims', () => {
    const actor = { kind: 'public-score' as const, eventId };
    expect(isPublicScoreIdentity(actor)).toBe(true);
    expect(isScoreActor(actor)).toBe(true);
    expect(isPublicBrowseIdentity({ kind: 'public-browse' })).toBe(true);
    expect(isScoreActor({ kind: 'public-browse' })).toBe(false);
    for (const invalid of [null, {}, { ...actor, eventId: '*' }, { ...actor, linkId: otherId },
      { ...actor, objectId: otherId }, { ...actor, tenantId: otherId }, { ...actor, role: 'owner' },
      { kind: 'public-browse' }, { ...actor, kind: 'public' },
      Object.assign(Object.create({ eventId }), { kind: 'public-score', other: true }),
    ]) expect(isPublicScoreIdentity(invalid)).toBe(false);
    for (const invalid of [actor, null, {}, { kind: 'public-browse', eventId }, { kind: 'public-browse', objectId: otherId },
      Object.assign(Object.create({ kind: 'public-browse' }), { other: true }),
    ]) expect(isPublicBrowseIdentity(invalid)).toBe(false);
  });

  it('compares the shared event-scoped public actor independently of account/tester identities', () => {
    const actor = { kind: 'public-score' as const, eventId };
    const tester = { kind: 'tester-link' as const, eventId, linkId: otherId };
    const account = { tenantId: eventId, objectId: otherId };
    expect(scoreActor(actor)).toEqual(actor);
    expect(scoreActor(actor)).not.toBe(actor);
    expect(sameScoreActor(actor, { ...actor })).toBe(true);
    expect(sameScoreActor(actor, { ...actor, eventId: otherId })).toBe(false);
    for (const other of [tester, account]) {
      expect(sameScoreActor(actor, other)).toBe(false);
      expect(sameScoreActor(other, actor)).toBe(false);
      expect(scoreActor(other)).toEqual(other);
    }
  });
});
