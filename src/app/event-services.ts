import { readClientSettings } from '../client/config';
import { createEventsClient } from '../client/events';
import { createEventSession } from '../client/identity';
import type { EventServices } from './EventsPage';

export function configureEventServices(env: Record<string, unknown>): { readonly services: EventServices | undefined; readonly configurationError?: string } {
  try {
    const settings = readClientSettings(env);
    if (!settings) return { services: undefined };
    const session = createEventSession(settings);
    return { services: { session, events: createEventsClient(settings.apiUrl, () => session.token()) } };
  } catch {
    return { services: undefined, configurationError: 'Identity/API configuration is invalid. No event connection was started.' };
  }
}
