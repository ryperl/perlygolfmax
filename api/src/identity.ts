import { createRemoteJWKSet, errors, jwtVerify } from 'jose';
import type { JWTVerifyGetKey } from 'jose';
import type { AccountIdentity } from '../../src/domain/events.js';
import { isUuid } from '../../src/contracts/events.js';
import type { ApiSettings } from './config.js';
import { ApiError } from './errors.js';

export type VerifyIdentity = (authorization: string | null) => Promise<AccountIdentity>;

export function createIdentityVerifier(settings: ApiSettings, keys: JWTVerifyGetKey = createRemoteJWKSet(new URL(settings.jwksUrl))): VerifyIdentity {
  return async (authorization) => {
    if (authorization && authorization.length > 8192) throw new ApiError(401, 'INVALID_ACCESS_TOKEN');
    const match = /^Bearer ([^\s]+)$/i.exec(authorization ?? '');
    const token = match?.[1];
    if (!token) throw new ApiError(401, 'AUTHENTICATION_REQUIRED');
    try {
      const { payload } = await jwtVerify(token, keys, {
        algorithms: ['RS256'],
        issuer: settings.issuer,
        audience: settings.audience,
        requiredClaims: ['exp', 'iat', 'nbf', 'tid', 'oid', 'scp', 'azp'],
      });
      if (payload.tid !== settings.tenantId || !isUuid(payload.oid)
        || payload.azp !== settings.clientId || payload.ver !== '2.0'
        || payload.idtyp === 'app'
        || typeof payload.scp !== 'string' || !payload.scp.split(' ').includes(settings.scope)) {
        throw new ApiError(401, 'INVALID_ACCESS_TOKEN');
      }
      return { tenantId: settings.tenantId, objectId: payload.oid };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (error instanceof errors.JOSEError) {
        if (error.code === 'ERR_JWKS_TIMEOUT') throw new ApiError(503, 'IDENTITY_PROVIDER_UNAVAILABLE');
        throw new ApiError(401, 'INVALID_ACCESS_TOKEN');
      }
      throw error;
    }
  };
}

export function canCreateEvents(identity: AccountIdentity, settings: ApiSettings): boolean {
  return identity.tenantId === settings.tenantId && identity.objectId === settings.creatorObjectId;
}

export function canManageCatalog(identity: AccountIdentity, settings: ApiSettings): boolean {
  return identity.tenantId === settings.tenantId && identity.objectId === settings.creatorObjectId;
}
