import { app } from '@azure/functions';
import { TableClient } from '@azure/data-tables';
import { DefaultAzureCredential } from '@azure/identity';
import { readSettings } from './config.js';
import { createHandler } from './events/handlers.js';
import type { EventApi } from './events/handlers.js';
import { TableEventStore } from './events/store.js';
import { canCreateEvents, canManageCatalog, createIdentityVerifier } from './identity.js';
import { TableRequestLimiter } from './limits.js';
import { TableCourseCatalog } from './catalog/courses.js';
import { TablePlayerCatalog } from './catalog/players.js';
import { TableWorkspaceStore } from './setup/store.js';
import { createCatalogHandler } from './catalog/handlers.js';
import type { CatalogAction, CatalogSetupApi } from './catalog/handlers.js';
import { createScoringHandler } from './scoring/handlers.js';
import type { ScoringApi } from './scoring/handlers.js';
import { TableScoreStore } from './scoring/store.js';

type RuntimeApi = EventApi & CatalogSetupApi & ScoringApi;
let api: RuntimeApi | undefined;

function resolveApi(): RuntimeApi {
  if (api) return api;
  const settings = readSettings(process.env);
  const table = new TableClient(settings.tableEndpoint, settings.tableName, new DefaultAzureCredential());
  const manager = (identity: Parameters<typeof canManageCatalog>[0]) => canManageCatalog(identity, settings);
  const courses = new TableCourseCatalog(table, manager);
  const players = new TablePlayerCatalog(table, manager);
  const workspace = new TableWorkspaceStore(table, courses, players, manager);
  api = {
    verify: createIdentityVerifier(settings),
    store: new TableEventStore(table),
    limiter: new TableRequestLimiter(table),
    canCreate: (identity) => canCreateEvents(identity, settings),
    canManageCatalog: manager, courses, players,
    workspace, scores: new TableScoreStore(table, workspace),
  };
  return api;
}

app.http('currentUser', { route: 'me', methods: ['GET'], authLevel: 'anonymous', handler: createHandler(resolveApi, 'me') });
app.http('events', { route: 'events', methods: ['GET', 'POST'], authLevel: 'anonymous', handler: createHandler(resolveApi, 'events') });
app.http('eventStatus', { route: 'events/{id}/status', methods: ['PATCH'], authLevel: 'anonymous', handler: createHandler(resolveApi, 'event-status') });

const catalogRoutes: readonly { readonly action: CatalogAction; readonly route: string; readonly methods: ('GET' | 'POST' | 'PUT' | 'PATCH')[] }[] = [
  { action: 'courses', route: 'catalog/courses', methods: ['GET'] },
  { action: 'course-version', route: 'catalog/courses/{courseId}/versions/{versionId}', methods: ['GET'] },
  { action: 'imports', route: 'catalog/courses/imports', methods: ['POST'] },
  { action: 'import', route: 'catalog/courses/imports/{importId}', methods: ['GET'] },
  { action: 'import-profile', route: 'catalog/courses/imports/{importId}/profiles/{profileId}', methods: ['PUT'] },
  { action: 'import-publish', route: 'catalog/courses/imports/{importId}/publish', methods: ['POST'] },
  { action: 'players', route: 'catalog/players', methods: ['GET', 'POST'] },
  { action: 'player', route: 'catalog/players/{playerId}', methods: ['PATCH'] },
  { action: 'indices', route: 'catalog/players/{playerId}/indices', methods: ['GET', 'POST'] },
  { action: 'workspace', route: 'events/{id}/workspace', methods: ['GET', 'PUT'] },
  { action: 'round-indices-refresh', route: 'events/{id}/workspace/rounds/{roundId}/indices/refresh', methods: ['POST'] },
];
for (const item of catalogRoutes) {
  app.http(`setup-${item.action}`, { route: item.route, methods: item.methods, authLevel: 'anonymous', handler: createCatalogHandler(resolveApi, item.action) });
}
app.http('roundScores', {
  route: 'events/{id}/rounds/{roundId}/scores', methods: ['GET'], authLevel: 'anonymous',
  handler: createScoringHandler(resolveApi, 'scores'),
});
app.http('scoreHole', {
  route: 'events/{id}/rounds/{roundId}/players/{playerId}/holes/{holeNumber}', methods: ['PUT'], authLevel: 'anonymous',
  handler: createScoringHandler(resolveApi, 'score-hole'),
});
app.http('scoreHistory', {
  route: 'events/{id}/rounds/{roundId}/players/{playerId}/score-history', methods: ['GET'], authLevel: 'anonymous',
  handler: createScoringHandler(resolveApi, 'score-history'),
});
app.http('roundGames', {
  route: 'events/{id}/rounds/{roundId}/games', methods: ['PUT'], authLevel: 'anonymous',
  handler: createScoringHandler(resolveApi, 'round-games'),
});
