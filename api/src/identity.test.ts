import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';
import { canCreateEvents, canManageCatalog, createIdentityVerifier } from './identity.js';
import type { VerifyIdentity } from './identity.js';
import { creator, member, settings } from '../test/fixtures.js';

let keys: Awaited<ReturnType<typeof generateKeyPair>>;
let verify: VerifyIdentity;
async function token(patch: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    iss: settings.issuer, aud: settings.audience, exp: now + 300, iat: now, nbf: now - 1,
    tid: settings.tenantId, oid: creator.objectId, azp: settings.clientId, scp: settings.scope, ver: '2.0', ...patch,
  }).setProtectedHeader({ alg: 'RS256' }).sign(keys.privateKey);
}
beforeAll(async () => {
  keys = await generateKeyPair('RS256');
  verify = createIdentityVerifier(settings, createLocalJWKSet({ keys: [await exportJWK(keys.publicKey)] }));
});

describe('access-token verification', () => {
  it('accepts a signed user access token for this exact API/tenant/client', async () => {
    await expect(verify(`Bearer ${await token()}`)).resolves.toEqual(creator);
  });
  it.each([
    { iss: 'https://other.example.test' }, { aud: settings.clientId }, { aud: 'https://graph.microsoft.com' },
    { tid: member.objectId }, { oid: 'unverified-email@example.test' }, { azp: member.objectId },
    { scp: 'Different.Scope' }, { scp: undefined }, { oid: undefined }, { exp: undefined },
    { nbf: undefined }, { idtyp: 'app' }, { exp: 1 }, { nbf: 9_999_999_999 }, { ver: '1.0' },
  ])('rejects wrong or missing claims %j', async (patch) => {
    await expect(verify(`Bearer ${await token(patch)}`)).rejects.toMatchObject({ status: 401 });
  });
  it('rejects forged signatures, oversized headers and unauthenticated callers', async () => {
    const other = await generateKeyPair('RS256');
    const forged = await new SignJWT({}).setProtectedHeader({ alg: 'RS256' }).sign(other.privateKey);
    await expect(verify(`Bearer ${forged}`)).rejects.toMatchObject({ status: 401 });
    await expect(verify(`Bearer ${'a'.repeat(8192)}`)).rejects.toMatchObject({ status: 401 });
    await expect(verify(null)).rejects.toMatchObject({ status: 401 });
  });
  it('does not equate event ownership or matching object ID in another tenant with global creation', () => {
    expect(canCreateEvents(creator, settings)).toBe(true);
    expect(canCreateEvents(member, settings)).toBe(false);
    expect(canCreateEvents({ ...creator, tenantId: member.objectId }, settings)).toBe(false);
  });
  it('grants the distinct catalog capability only to the explicitly configured tenant and organizer', () => {
    expect(canManageCatalog(creator, settings)).toBe(true);
    expect(canManageCatalog(member, settings)).toBe(false);
    expect(canManageCatalog({ ...creator, tenantId: member.objectId }, settings)).toBe(false);
  });
});
