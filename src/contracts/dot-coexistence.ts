import type { RoundScores } from '../domain/scoring.js';

export class DotsCoexistenceClientUpdateRequired extends Error {
  readonly status = 426;
  readonly code = 'DOTS_COEXISTENCE_CLIENT_UPDATE_REQUIRED';
  constructor() { super('Refresh the client to review and repair incompatible Dots declarations.'); }
}

export function coexistenceRoundScores(round: RoundScores, negotiated = false): RoundScores {
  if (negotiated) return round;
  const legacy = { ...round };
  delete legacy.dotsCoexistenceRulesVersion;
  return legacy;
}
