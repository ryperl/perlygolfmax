/**
 * Request-scoped Nines negotiation. Every HTTP route runs inside `withNinesNegotiation`, which
 * records which Nines level the caller asked for (`nines=1` or `nines=2`). Code deep inside stores and transports can then ask
 * `clientSupportsNines()` or call `requireNinesSupport()` without threading another flag through
 * every function signature.
 *
 * Fails closed: outside a wrapped request (for example a store called directly) Nines counts as
 * unsupported, so it can never leak to an older client by accident.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import type { HttpHandler, HttpRequest, HttpResponse, HttpResponseInit, InvocationContext } from '@azure/functions';
import { containsNinesGame, containsNinesLinkedDots, ninesClientUpdateCode } from '../../src/contracts/nines-negotiation.js';
import { ApiError } from './errors.js';
import { response } from './http.js';

/** 0: no Nines; 1: Nines; 2: Nines and Dots linked to Nines. */
type NinesLevel = 0 | 1 | 2;

interface NinesRequestState {
  readonly level: NinesLevel;
  /** Set when a check refused this request, so the wrapper always answers 426. */
  updateRequired: boolean;
}

const requestState = new AsyncLocalStorage<NinesRequestState>();

export class NinesClientUpdateRequired extends ApiError {
  constructor() { super(426, ninesClientUpdateCode); }
}

function clientLevel(): NinesLevel {
  return requestState.getStore()?.level ?? 0;
}

/** The client understands Nines games (it may still predate Dots linked to Nines). */
export function clientSupportsNines(): boolean {
  return clientLevel() >= 1;
}

/** The client understands everything Nines-related, so compatibility scans can be skipped. */
export function clientSupportsAllNinesRules(): boolean {
  return clientLevel() >= 2;
}

/** True when the value holds something this client's Nines level cannot read. */
function beyondClient(value: unknown): boolean {
  const level = clientLevel();
  if (level < 1 && containsNinesGame(value)) return true;
  return level < 2 && containsNinesLinkedDots(value);
}

/** Refuses the request before any change is made when it involves Nines and the client cannot read it. */
export function requireNinesSupport(value: unknown): void {
  if (!beyondClient(value)) return;
  const state = requestState.getStore();
  if (state) state.updateRequired = true;
  throw new NinesClientUpdateRequired();
}

function requestedLevel(request: HttpRequest): NinesLevel {
  const values = request.query.getAll('nines');
  if (values.length !== 1) return 0;
  if (values[0] === '2') return 2;
  return values[0] === '1' ? 1 : 0;
}

/** Runs one request with its Nines support recorded, and guards the response it produces. */
export function withNinesNegotiation(handler: HttpHandler): HttpHandler {
  return async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit | HttpResponse> => {
    const state: NinesRequestState = { level: requestedLevel(request), updateRequired: false };
    const result = await requestState.run(state, () => handler(request, context));
    if (state.updateRequired) return response(426, { code: ninesClientUpdateCode });
    // Routes here answer with plain response objects; anything else is passed through untouched.
    const body: unknown = 'jsonBody' in result ? result.jsonBody : undefined;
    const readable = requestState.run(state, () => !beyondClient(body));
    if (!readable) return response(426, { code: ninesClientUpdateCode });
    return result;
  };
}

/** Lets tests call stores directly as a client at a given Nines level (true means the newest). */
export function runWithNinesSupport<T>(support: boolean | NinesLevel, run: () => T): T {
  const level: NinesLevel = support === true ? 2 : support === false ? 0 : support;
  return requestState.run({ level, updateRequired: false }, run);
}
