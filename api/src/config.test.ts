import { describe, expect, it } from 'vitest';
import { readSettings } from './config.js';
import { settings } from '../test/fixtures.js';

const env = {
  ENTRA_TENANT_ID: settings.tenantId, ENTRA_ISSUER: settings.issuer, ENTRA_JWKS_URL: settings.jwksUrl,
  ENTRA_API_CLIENT_ID: settings.audience, ENTRA_SPA_CLIENT_ID: settings.clientId, ENTRA_API_SCOPE: settings.scope,
  EVENT_CREATOR_OBJECT_ID: settings.creatorObjectId, EVENTS_TABLE_ENDPOINT: settings.tableEndpoint, EVENTS_TABLE_NAME: settings.tableName,
};

describe('API configuration', () => {
  it('requires explicit issuer, API identity, creator bootstrap and storage', () => {
    expect(readSettings(env)).toEqual(settings);
    for (const key of Object.keys(env)) {
      const partial = Object.fromEntries(Object.entries(env).filter(([name]) => name !== key));
      expect(() => readSettings(partial)).toThrow('SERVICE_NOT_CONFIGURED');
    }
  });
  it.each([
    { ENTRA_JWKS_URL: 'http://untrusted.example.test/keys' },
    { ENTRA_ISSUER: 'https://example.test?embedded=value' },
    { EVENT_CREATOR_OBJECT_ID: 'first-user' },
    { EVENTS_TABLE_NAME: '../Elsewhere' },
  ])('rejects unsafe configuration %j', (patch) => {
    expect(() => readSettings({ ...env, ...patch })).toThrow('SERVICE_NOT_CONFIGURED');
  });
});
