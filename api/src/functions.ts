import { app } from '@azure/functions';
import { TableClient } from '@azure/data-tables';
import { DefaultAzureCredential } from '@azure/identity';
import { readSettings } from './config.js';
import { createHandler } from './events/handlers.js';
import type { EventApi } from './events/handlers.js';
import { TableEventStore } from './events/store.js';
import { canCreateEvents, createIdentityVerifier } from './identity.js';
import { TableRequestLimiter } from './limits.js';

let api: EventApi | undefined;

function resolveApi(): EventApi {
  if (api) return api;
  const settings = readSettings(process.env);
  const table = new TableClient(settings.tableEndpoint, settings.tableName, new DefaultAzureCredential());
  api = {
    verify: createIdentityVerifier(settings),
    store: new TableEventStore(table),
    limiter: new TableRequestLimiter(table),
    canCreate: (identity) => canCreateEvents(identity, settings),
  };
  return api;
}

app.http('currentUser', { route: 'me', methods: ['GET'], authLevel: 'anonymous', handler: createHandler(resolveApi, 'me') });
app.http('events', { route: 'events', methods: ['GET', 'POST'], authLevel: 'anonymous', handler: createHandler(resolveApi, 'events') });
app.http('eventStatus', { route: 'events/{id}/status', methods: ['PATCH'], authLevel: 'anonymous', handler: createHandler(resolveApi, 'event-status') });
