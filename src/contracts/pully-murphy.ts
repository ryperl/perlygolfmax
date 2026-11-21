import { isRecord } from './events.js';

export class PullyMurphyClientUpdateRequired extends Error {
  readonly status = 426;
  readonly code = 'PULLY_MURPHY_CLIENT_UPDATE_REQUIRED';
  constructor() { super('Refresh the client before using score-derived Pully Murphy calls.'); }
}

export function requirePullyMurphyTargets(value: unknown, supported: boolean): void {
  if (supported) return;
  if (Array.isArray(value)) value.forEach((entry) => { requirePullyMurphyTargets(entry, false); });
  else if (isRecord(value)) {
    if (Object.hasOwn(value, 'pullyMurphyTarget')) throw new PullyMurphyClientUpdateRequired();
    Object.values(value).forEach((entry) => { requirePullyMurphyTargets(entry, false); });
  }
}
