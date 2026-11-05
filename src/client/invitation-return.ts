import { isUuid } from '../contracts/events';
import { isAdmissionToken } from '../contracts/admission';

const storageKey = 'perly-golf-max:invitation-return';
const lifetimeMs = 30 * 60 * 1000;

export function validInvitationRoute(hash: string): boolean {
  if (!hash.startsWith('#join?')) return false;
  const query = new URLSearchParams(hash.slice(6));
  const event = query.getAll('event');
  if (event.length !== 1 || !isUuid(event[0])) return false;
  const claims = query.getAll('claim');
  if (claims.length) return claims.length === 1 && isUuid(claims[0])
    && [...query.keys()].every((key) => key === 'event' || key === 'claim');
  const invites = query.getAll('invite');
  const tokens = query.getAll('token');
  return invites.length === 1 && isUuid(invites[0]) && tokens.length === 1
    && isAdmissionToken(tokens[0])
    && [...query.keys()].every((key) => ['event', 'invite', 'token'].includes(key));
}

/** Only the private invitation continuation, never an access token or score data. */
export function rememberInvitationReturn(hash: string, storage: Storage = sessionStorage, now = Date.now()): void {
  if (!validInvitationRoute(hash)) return;
  storage.setItem(storageKey, JSON.stringify({ hash, expiresAt: now + lifetimeMs }));
}

export function consumeInvitationReturn(storage: Storage = sessionStorage, now = Date.now()): string | null {
  const stored = storage.getItem(storageKey);
  if (stored === null) return null;
  storage.removeItem(storageKey);
  let value: unknown;
  try { value = JSON.parse(stored); } catch { return null; }
  if (typeof value !== 'object' || value === null || !('hash' in value) || !('expiresAt' in value)
    || typeof value.hash !== 'string' || typeof value.expiresAt !== 'number'
    || !Number.isSafeInteger(value.expiresAt) || value.expiresAt <= now || value.expiresAt > now + lifetimeMs
    || !validInvitationRoute(value.hash)) return null;
  return value.hash;
}

export function clearInvitationReturn(storage: Storage = sessionStorage): void {
  storage.removeItem(storageKey);
}
