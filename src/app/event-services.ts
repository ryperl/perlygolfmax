import { readClientSettings } from '../client/config';
import { createEventsClient } from '../client/events';
import { createCatalogClient } from '../client/catalog';
import { createSetupClient } from '../client/setup';
import { createScoresClient } from '../client/scoring';
import { createEventLeaderboardClient } from '../client/event-leaderboard';
import { createPurseClient } from '../client/purse';
import { createAdmissionsClient } from '../client/admission';
import { createTesterAccessClient } from '../client/test-access';
import { createEventSession } from '../client/identity';
import type { EventServices } from './EventsPage';

export function configureEventServices(env: Record<string, unknown>): { readonly services: EventServices | undefined; readonly configurationError?: string } {
  try {
    const settings = readClientSettings(env);
    if (!settings) return { services: undefined };
    const session = createEventSession(settings);
    const token = () => session.token();
    return { services: { session, events: createEventsClient(settings.apiUrl, token),
      catalog: createCatalogClient(settings.apiUrl, token), setup: createSetupClient(settings.apiUrl, token),
      scores: createScoresClient(settings.apiUrl, token),
      leaderboard: createEventLeaderboardClient(settings.apiUrl, token), purse: createPurseClient(settings.apiUrl, token),
      admissions: createAdmissionsClient(settings.apiUrl, token),
      testerAccess: createTesterAccessClient(settings.apiUrl, token) } };
  } catch {
    return { services: undefined, configurationError: 'Identity/API configuration is invalid. No event connection was started.' };
  }
}
