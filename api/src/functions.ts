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
import { TablePurseStore } from './purse/store.js';
import { createPurseHandler } from './purse/handlers.js';
import type { PurseApi } from './purse/handlers.js';
import { TableAdmissionStore } from './admission/store.js';
import type { AdmissionStore } from './admission/store.js';
import { createAdmissionHandler } from './admission/handlers.js';
import type { AdmissionAction, AdmissionApi } from './admission/handlers.js';
import { TableTesterAccessStore } from './test-access/store.js';
import { createTesterHandler } from './test-access/handlers.js';
import type { TesterAction } from './test-access/handlers.js';
import { createPublicHandler } from './public-access/handlers.js';
import type { PublicAction, PublicApi } from './public-access/handlers.js';
import { createPublicApi } from './public-access/runtime.js';

type RuntimeApi = EventApi & CatalogSetupApi & ScoringApi & PurseApi & {
  readonly admissions: AdmissionStore;
  readonly testers: TableTesterAccessStore;
};
let api: RuntimeApi | undefined;

function resolveApi(): RuntimeApi {
  if (api) return api;
  const settings = readSettings(process.env);
  const table = new TableClient(settings.tableEndpoint, settings.tableName, new DefaultAzureCredential());
  const manager = (identity: Parameters<typeof canManageCatalog>[0]) => canManageCatalog(identity, settings);
  const courses = new TableCourseCatalog(table, manager);
  const players = new TablePlayerCatalog(table, manager);
  const workspace = new TableWorkspaceStore(table, courses, players, manager);
  const scores = new TableScoreStore(table, workspace);
  api = {
    verify: createIdentityVerifier(settings),
    store: new TableEventStore(table),
    limiter: new TableRequestLimiter(table),
    canCreate: (identity) => canCreateEvents(identity, settings),
    canManageCatalog: manager, courses, players,
    workspace, scores, purse: new TablePurseStore(table, workspace, scores),
    admissions: new TableAdmissionStore(table),
    testers: new TableTesterAccessStore(table),
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
app.http('eventLeaderboard', {
  route: 'events/{id}/leaderboard', methods: ['GET'], authLevel: 'anonymous',
  handler: createScoringHandler(resolveApi, 'event-leaderboard'),
});
app.http('eventPurse', {
  route: 'events/{id}/purse', methods: ['GET', 'PUT'], authLevel: 'anonymous',
  handler: createPurseHandler(resolveApi),
});

function resolveAdmissionApi(): AdmissionApi {
  const resolved = resolveApi();
  return { verify: resolved.verify, limiter: resolved.limiter, store: resolved.admissions };
}
const admissionRoutes: readonly { readonly action: AdmissionAction; readonly suffix: string; readonly method: 'GET' | 'POST' }[] = [
  { action: 'list', suffix: '', method: 'GET' },
  { action: 'status', suffix: '/status', method: 'GET' },
  { action: 'invite', suffix: '/invite', method: 'POST' },
  { action: 'claim', suffix: '/claim', method: 'POST' },
  { action: 'approve', suffix: '/approve', method: 'POST' },
  { action: 'revoke', suffix: '/revoke', method: 'POST' },
];
for (const item of admissionRoutes) app.http(`playerAdmission-${item.action}`, {
  route: `events/{id}/admissions${item.suffix}`, methods: [item.method], authLevel: 'anonymous',
  handler: createAdmissionHandler(resolveAdmissionApi, item.action),
});

const testerRoutes: readonly { readonly action: TesterAction; readonly route: string; readonly method: 'GET' | 'POST' | 'PUT' }[] = [
  { action: 'list', route: 'events/{id}/test-access', method: 'GET' },
  { action: 'create', route: 'events/{id}/test-access/create', method: 'POST' },
  { action: 'revoke', route: 'events/{id}/test-access/revoke', method: 'POST' },
  { action: 'renew', route: 'events/{id}/test-access/renew', method: 'POST' },
  { action: 'workspace', route: 'tester/events/{id}/workspace', method: 'GET' },
  { action: 'scores', route: 'tester/events/{id}/rounds/{roundId}/scores', method: 'GET' },
  { action: 'score-hole', route: 'tester/events/{id}/rounds/{roundId}/players/{playerId}/holes/{holeNumber}', method: 'PUT' },
];
for (const item of testerRoutes) app.http(`testerAccess-${item.action}`, {
  route: item.route, methods: [item.method], authLevel: 'anonymous', handler: createTesterHandler(resolveApi, item.action),
});

const publicRoutes: readonly { readonly action: PublicAction; readonly route: string; readonly method: 'GET' | 'PUT' }[] = [
  { action: 'events', route: 'public/events', method: 'GET' },
  { action: 'workspace', route: 'public/events/{id}/workspace', method: 'GET' },
  { action: 'scores', route: 'public/events/{id}/rounds/{roundId}/scores', method: 'GET' },
  { action: 'score-hole', route: 'public/events/{id}/rounds/{roundId}/players/{playerId}/holes/{holeNumber}', method: 'PUT' },
  { action: 'event-leaderboard', route: 'public/events/{id}/leaderboard', method: 'GET' },
  { action: 'purse', route: 'public/events/{id}/purse', method: 'GET' },
];
let publicApi: PublicApi | undefined;
function resolvePublicApi(): PublicApi {
  publicApi ??= createPublicApi(process.env);
  return publicApi;
}
for (const item of publicRoutes) app.http(`publicAccess-${item.action}`, {
  route: item.route, methods: [item.method], authLevel: 'anonymous', handler: createPublicHandler(resolvePublicApi, item.action),
});
