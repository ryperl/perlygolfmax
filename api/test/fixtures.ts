import type { ApiSettings } from '../src/config.js';

export const settings: ApiSettings = {
  tenantId: '00000000-0000-4000-8000-000000000001',
  audience: '00000000-0000-4000-8000-000000000002',
  clientId: '00000000-0000-4000-8000-000000000003',
  creatorObjectId: '00000000-0000-4000-8000-000000000004',
  issuer: 'https://fictional.ciamlogin.com/fictional/v2.0',
  jwksUrl: 'https://fictional.ciamlogin.com/fictional/keys',
  scope: 'Events.Access',
  tableEndpoint: 'https://fictional.table.core.windows.net',
  tableName: 'Events',
};
export const creator = { tenantId: settings.tenantId, objectId: settings.creatorObjectId };
export const member = { tenantId: settings.tenantId, objectId: '00000000-0000-4000-8000-000000000005' };
export const event = { id: '00000000-0000-4000-8000-000000000006', name: 'Fictional Open', createdAt: '2026-01-01T00:00:00Z' };
