// @vitest-environment node
import { app, HttpRequest, InvocationContext } from '@azure/functions';
import { describe, expect, it, vi } from 'vitest';
import { createEventAdministrationClient } from '../client/event-administration';
import { SessionExpiredError } from '../client/events';
import { registerEventAdministration } from '../../api/src/event-administration/handlers';
import { TableEventAdministration } from '../../api/src/event-administration/store';
import { memoryTable, identifier } from '../../api/test/catalog-fixtures';
import { event } from '../../api/test/fixtures';
import { ApiError } from '../../api/src/errors';

describe('organizer client and actual HTTP registrations', () => {
  it('reaches authentication on every route under Azure Functions reserved-prefix rules', async () => {
    const table = memoryTable();
    const verify = vi.fn().mockRejectedValue(new ApiError(401, 'AUTHENTICATION_REQUIRED'));
    const api = { verify, limiter: { check: vi.fn() },
      administration: new TableEventAdministration(table.table, () => false) };
    const registered = vi.spyOn(app, 'http').mockImplementation(() => undefined);
    try {
      registerEventAdministration(() => api);
      const routes = registered.mock.calls.map(([, options]) => options);
      expect(routes).toHaveLength(5);
      const context = new InvocationContext({ logHandler: () => undefined });
      const send = vi.fn<typeof fetch>().mockImplementation(async (target, options) => {
        const url = new URL(typeof target === 'string' ? target : target instanceof URL ? target.href : target.url);
        const path = url.pathname.slice('/api/'.length), method = options?.method ?? 'GET';
        const binding = routes.find((route) => route.route?.replace('{id}', event.id) === path
          && route.methods?.some((candidate) => candidate === method));
        // ScriptHost.ValidateHttpFunction rejects these prefixes, not just exact path segments.
        if (!binding?.route || /^(admin|runtime)/i.test(binding.route.replace(/^\/+/, ''))) {
          return new Response(null, { status: 404 });
        }
        const result = await binding.handler(new HttpRequest({ method, url: url.href,
          params: { id: event.id }, headers: Object.fromEntries(new Headers(options?.headers).entries()),
          ...(typeof options?.body === 'string' ? { body: { string: options.body } } : {}) }), context);
        return new Response(null, { status: result.status ?? 200 });
      });
      const client = createEventAdministrationClient('https://fictional.example/api',
        () => Promise.resolve('fictional-token'), send);
      const signal = new AbortController().signal, requestId = identifier(980);
      const archived = { id: event.id, name: event.name, etag: 'fictional-v1', status: 'archived' as const };
      for (const request of [
        () => client.listQuick(signal),
        () => client.listDeletions(signal),
        () => client.restore(archived, requestId, signal),
        () => client.deleteArchived(archived, archived.name, requestId, signal),
        () => client.continueDeletion(event.id, requestId, signal),
      ]) await expect(request()).rejects.toBeInstanceOf(SessionExpiredError);
      expect(send).toHaveBeenCalledTimes(5);
      expect(verify).toHaveBeenCalledTimes(5);
      expect(api.limiter.check).not.toHaveBeenCalled();
      expect(table.submit).not.toHaveBeenCalled();
    } finally { registered.mockRestore(); }
  });
});
