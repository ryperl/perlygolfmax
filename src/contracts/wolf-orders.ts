import type { RoundGameDefinition } from '../domain/games.js';
import type { RoundScores } from '../domain/scoring.js';
import { isRecord } from './events.js';

export class WolfOrdersClientUpdateRequired extends Error {
  readonly status = 426;
  readonly code = 'WOLF_ORDERS_CLIENT_UPDATE_REQUIRED';
  constructor() { super('Refresh before using first-tee Wolf order.'); }
}

export function requireWolfOrders(games: readonly RoundGameDefinition[], supported: boolean): void {
  if (!supported && games.some((game) => game.kind === 'wolf' && game.orderMode !== undefined)) {
    throw new WolfOrdersClientUpdateRequired();
  }
}

export function wolfOrderRoundScores(round: RoundScores, supported = false): RoundScores {
  requireWolfOrdersInValue(round, supported);
  if (supported) return round;
  const legacy = { ...round };
  delete legacy.wolfOrderVersion;
  return legacy;
}

/** Checks nested score, game, correction and purse publications as well as bare rounds. */
export function requireWolfOrdersInValue(value: unknown, supported = false): void {
  if (supported) return;
  if (Array.isArray(value)) {
    for (const entry of value) requireWolfOrdersInValue(entry);
  } else if (isRecord(value)) {
    if (value.kind === 'wolf' && value.orderMode !== undefined
      || isRecord(value.choice) && (value.choice.mode === 'order' || value.order !== undefined)) {
      throw new WolfOrdersClientUpdateRequired();
    }
    for (const entry of Object.values(value)) requireWolfOrdersInValue(entry);
  }
}
