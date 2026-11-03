import { isUuid } from '../../src/contracts/events.js';
import { ApiError } from './errors.js';

export interface ApiSettings {
  readonly tenantId: string;
  readonly issuer: string;
  readonly jwksUrl: string;
  readonly audience: string;
  readonly clientId: string;
  readonly scope: string;
  readonly creatorObjectId: string;
  readonly tableEndpoint: string;
  readonly tableName: string;
}

export function readSettings(env: NodeJS.ProcessEnv): ApiSettings {
  const tenantId = env.ENTRA_TENANT_ID;
  const issuer = env.ENTRA_ISSUER;
  const jwksUrl = env.ENTRA_JWKS_URL;
  const audience = env.ENTRA_API_CLIENT_ID;
  const clientId = env.ENTRA_SPA_CLIENT_ID;
  const scope = env.ENTRA_API_SCOPE;
  const creatorObjectId = env.EVENT_CREATOR_OBJECT_ID;
  const tableEndpoint = env.EVENTS_TABLE_ENDPOINT;
  const tableName = env.EVENTS_TABLE_NAME;
  const secureUrl = (value: string | undefined) => {
    if (!value) return false;
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash;
    } catch { return false; }
  };
  if (!isUuid(tenantId) || !isUuid(audience) || !isUuid(clientId) || !isUuid(creatorObjectId)
    || !issuer || !secureUrl(issuer) || !jwksUrl || !secureUrl(jwksUrl)
    || !scope || !/^[\w.-]+$/.test(scope) || !tableEndpoint || !secureUrl(tableEndpoint)
    || !tableName || !/^[A-Za-z][A-Za-z0-9]{2,62}$/.test(tableName)) {
    throw new ApiError(503, 'SERVICE_NOT_CONFIGURED');
  }
  return { tenantId, issuer, jwksUrl, audience, clientId, scope, creatorObjectId, tableEndpoint, tableName };
}
