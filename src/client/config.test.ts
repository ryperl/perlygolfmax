import { describe, expect, it } from 'vitest';
import { readClientSettings } from './config';

const env = {
  VITE_ENTRA_SPA_CLIENT_ID: '00000000-0000-4000-8000-000000000001',
  VITE_ENTRA_TENANT_ID: '00000000-0000-4000-8000-000000000003',
  VITE_ENTRA_SUBDOMAIN: 'fictional',
  VITE_ENTRA_API_SCOPE: 'api://00000000-0000-4000-8000-000000000002/Events.Access',
  VITE_API_URL: 'https://fictional.example.test/api/',
};
describe('client configuration', () => {
  it('distinguishes unconfigured from invalid configuration and uses the customer authority', () => {
    expect(readClientSettings({})).toBeUndefined();
    expect(readClientSettings(env)).toMatchObject({
      authority: 'https://fictional.ciamlogin.com/00000000-0000-4000-8000-000000000003',
      apiUrl: 'https://fictional.example.test/api',
    });
    expect(() => readClientSettings({ VITE_API_URL: env.VITE_API_URL })).toThrow();
  });
  it('requires the explicit customer tenant to avoid name/GUID issuer discovery ambiguity', () => {
    expect(() => readClientSettings({ ...env, VITE_ENTRA_TENANT_ID: '' })).toThrow();
    expect(() => readClientSettings({ ...env, VITE_ENTRA_TENANT_ID: 'common' })).toThrow();
  });
  it.each(['http://untrusted.example.test', 'https://example.test?embedded=value', 'https://example.test/#secret'])('rejects unsafe API URL %s', (url) => {
    expect(() => readClientSettings({ ...env, VITE_API_URL: url })).toThrow();
  });
});
