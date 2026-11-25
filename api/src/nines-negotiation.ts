/**
 * Request-scoped Nines negotiation. Every HTTP route runs inside `withNinesNegotiation`, which
 * records whether the caller sent `nines=1`. Code deep inside stores and transports can then ask
 * `clientSupportsNines()` or call `requireNinesSupport()` without threading another flag through
 * every function signature.
 *
 * Fails closed: outside a wrapped request (for example a store called directly) Nines counts as
 * unsupported, so it can never leak to an older client by accident.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import type { HttpHandler, HttpRequest, HttpResponse, HttpResponseInit, InvocationContext } from '@azure/functions';
import { containsNinesGame, ninesClientUpdateCode } from '../../src/contracts/nines-negotiation.js';
import { ApiError } from './errors.js';
import { response } from './http.js';

interface NinesRequestState {
  readonly supported: boolean;
  /** Set when a check refused this request, so the wrapper always answers 426. */
  updateRequired: boolean;
}

const requestState = new AsyncLocalStorage<NinesRequestState>();

export class NinesClientUpdateRequired extends ApiError {
  constructor() { super(426, ninesClientUpdateCode); }
}

export function clientSupportsNines(): boolean {
  return requestState.getStore()?.supported === true;
}

/** Refuses the request before any change is made when it involves Nines and the client cannot read it. */
export function requireNinesSupport(value: unknown): void {
  if (clientSupportsNines() || !containsNinesGame(value)) return;
  const state = requestState.getStore();
  if (state) state.updateRequired = true;
  throw new NinesClientUpdateRequired();
}

function asksForNines(request: HttpRequest): boolean {
  return request.query.getAll('nines').length === 1 && request.query.get('nines') === '1';
}

/** Runs one request with its Nines support recorded, and guards the response it produces. */
export function withNinesNegotiation(handler: HttpHandler): HttpHandler {
  return async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit | HttpResponse> => {
    const state: NinesRequestState = { supported: asksForNines(request), updateRequired: false };
    const result = await requestState.run(state, () => handler(request, context));
    if (state.updateRequired) return response(426, { code: ninesClientUpdateCode });
    // Routes here answer with plain response objects; anything else is passed through untouched.
    const body: unknown = 'jsonBody' in result ? result.jsonBody : undefined;
    if (!state.supported && containsNinesGame(body)) return response(426, { code: ninesClientUpdateCode });
    return result;
  };
}

/** Lets tests call stores directly as a client that does (or does not) understand Nines. */
export function runWithNinesSupport<T>(supported: boolean, run: () => T): T {
  return requestState.run({ supported, updateRequired: false }, run);
}
