import { describe, expect, it } from 'vitest';
import { EventChangedError, SessionExpiredError } from '../../client/events';
import { PrivateRequestError } from '../../client/private-request';
import { admissionFailure } from './shared';

describe('safe invitation failure copy', () => {
  it('distinguishes real authentication expiry from authorization and missing/expired links', () => {
    expect(admissionFailure(new SessionExpiredError('fictional'))).toMatchObject({ expired: true, denied: true });
    expect(admissionFailure(new PrivateRequestError(401, 'fictional'))).toMatchObject({ expired: true, denied: true });
    for (const status of [403, 404]) expect(admissionFailure(new PrivateRequestError(status, 'fictional'))).toMatchObject({ expired: false, denied: true });
    expect(admissionFailure(new PrivateRequestError(410, 'fictional')).message).toContain('invitation has expired');
  });
  it('marks conflicts for review and hides untrusted diagnostic content', () => {
    expect(admissionFailure(new EventChangedError('fictional')).conflict).toBe(true);
    expect(admissionFailure(new PrivateRequestError(409, 'fictional')).conflict).toBe(true);
    expect(admissionFailure(new Error('private diagnostic')).message).not.toContain('private diagnostic');
    expect(admissionFailure(new PrivateRequestError(429, 'fictional')).definitive).toBe(false);
    expect(admissionFailure(undefined).message).toContain('did not confirm');
  });
});
