import { TableClient } from '@azure/data-tables';
import { DefaultAzureCredential } from '@azure/identity';
import { TableCourseCatalog } from '../catalog/courses.js';
import { TablePlayerCatalog } from '../catalog/players.js';
import { TableWorkspaceStore } from '../setup/store.js';
import { TableScoreStore } from '../scoring/store.js';
import { TablePurseStore } from '../purse/store.js';
import { TableRequestLimiter } from '../limits.js';
import { ApiError } from '../errors.js';
import type { PublicApi } from './handlers.js';
import { TablePublicEventStore } from './store.js';

export function createPublicApi(env: NodeJS.ProcessEnv): PublicApi {
  const endpoint = env.EVENTS_TABLE_ENDPOINT;
  const name = env.EVENTS_TABLE_NAME;
  if (!endpoint || !name || !/^[A-Za-z][A-Za-z0-9]{2,62}$/.test(name)) throw new ApiError(503, 'SERVICE_NOT_CONFIGURED');
  try {
    const url = new URL(endpoint);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('Invalid storage endpoint');
  } catch { throw new ApiError(503, 'SERVICE_NOT_CONFIGURED'); }
  const table = new TableClient(endpoint, name, new DefaultAzureCredential());
  const denyCatalog = () => false;
  const workspace = new TableWorkspaceStore(table, new TableCourseCatalog(table, denyCatalog),
    new TablePlayerCatalog(table, denyCatalog), denyCatalog);
  const scores = new TableScoreStore(table, workspace);
  return { publicEvents: new TablePublicEventStore(table), limiter: new TableRequestLimiter(table),
    workspace, scores, purse: new TablePurseStore(table, workspace, scores) };
}
