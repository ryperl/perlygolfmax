import { isUuid } from '../contracts/events';

export interface ClientSettings {
  readonly clientId: string;
  readonly authority: string;
  readonly scope: string;
  readonly apiUrl: string;
}

export function readClientSettings(env: Record<string, unknown>): ClientSettings | undefined {
  const clientId = env.VITE_ENTRA_SPA_CLIENT_ID;
  const tenantId = env.VITE_ENTRA_TENANT_ID;
  const subdomain = env.VITE_ENTRA_SUBDOMAIN;
  const scope = env.VITE_ENTRA_API_SCOPE;
  const apiUrl = env.VITE_API_URL;
  if (!clientId && !tenantId && !subdomain && !scope && !apiUrl) return undefined;
  if (!isUuid(clientId) || !isUuid(tenantId) || typeof subdomain !== 'string' || !/^[a-z0-9-]+$/.test(subdomain)
    || typeof scope !== 'string' || !/^api:\/\/[0-9a-f-]{36}\/[\w.-]+$/i.test(scope)
    || typeof apiUrl !== 'string') throw new Error('Event service configuration is incomplete or invalid.');
  const url = new URL(apiUrl);
  const loopback = ['localhost', '127.0.0.1'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback))
    || url.username || url.password || url.search || url.hash) throw new Error('Event API must use a trusted HTTPS endpoint.');
  return { clientId, authority: `https://${subdomain}.ciamlogin.com/${tenantId}`, scope, apiUrl: apiUrl.replace(/\/$/, '') };
}
