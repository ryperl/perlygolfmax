import { useEffect, useRef, useState } from 'react';
import { EventsView } from '../features/events';
import type { EventsState } from '../features/events';
import type { EventsClient } from '../client/events';
import { SessionExpiredError } from '../client/events';
import type { EventSession } from '../client/identity';
import { configureEventServices } from './event-services';

const configuredServices = configureEventServices(import.meta.env);

export function ConfiguredEventsPage() {
  return <EventsPage {...configuredServices} />;
}

export interface EventServices {
  readonly session: EventSession;
  readonly events: EventsClient;
}

export function EventsPage({ services, configurationError }: { readonly services: EventServices | undefined; readonly configurationError?: string }) {
  const [state, setState] = useState<EventsState>({ kind: 'loading' });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const request = useRef<AbortController | null>(null);
  const pendingCreate = useRef<{ readonly name: string; readonly id: string } | null>(null);
  const mounted = useRef(false);
  const running = useRef(false);

  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    request.current = controller;
    if (services) {
      void services.session.initialize().then(async (signedIn) => {
        if (!signedIn) return { kind: 'signed-out' } satisfies EventsState;
        const capabilities = await services.events.capabilities(controller.signal);
        const page = await services.events.list(controller.signal);
        return { kind: 'ready', capabilities, page } satisfies EventsState;
      }).then((result) => { if (!controller.signal.aborted) setState(result); })
        .catch((error: unknown) => {
          if (!controller.signal.aborted) setState(error instanceof SessionExpiredError
            ? { kind: 'signed-out', message: error.message }
            : { kind: 'error', message: 'Could not connect to your event services. No saved data was loaded.' });
        });
    }
    return () => { mounted.current = false; controller.abort(); };
  }, [services]);

  async function run(operation: (service: EventServices, signal: AbortSignal) => Promise<void>) {
    if (!services || running.current) return false;
    running.current = true;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setNotice('');
    try {
      await operation(services, controller.signal);
      return mounted.current && !controller.signal.aborted;
    }
    catch (error) {
      if (mounted.current && !controller.signal.aborted) {
        if (error instanceof SessionExpiredError) setState({ kind: 'signed-out', message: error.message });
        else setNotice('The operation failed. Nothing was confirmed saved. Try again; an event retry uses the same request ID.');
      }
      return false;
    } finally {
      running.current = false;
      if (mounted.current && !controller.signal.aborted) setBusy(false);
    }
  }

  return <EventsView
    state={services ? state : { kind: 'unconfigured', message: configurationError ?? 'Identity and API settings have not been supplied.' }}
    busy={busy} notice={notice}
    onSignIn={() => { void run(async ({ session }) => { await session.signIn(); }); }}
    onSignOut={() => { void run(async ({ session }) => {
      setState({ kind: 'signed-out' });
      try { await session.signOut(); }
      catch {
        setNotice('Sign-out did not complete. The identity-provider session may still be active.');
      }
    }); }}
    onReload={() => { void run(async (service, signal) => {
      if (!await service.session.initialize()) {
        if (!signal.aborted) setState({ kind: 'signed-out' });
        return;
      }
      const capabilities = await service.events.capabilities(signal);
      const page = await service.events.list(signal);
      if (!signal.aborted) setState({ kind: 'ready', capabilities, page });
    }); }}
    onNextPage={() => { void run(async (service, signal) => {
      if (state.kind !== 'ready') return;
      const page = await service.events.list(signal, state.page.continuationToken);
      if (!signal.aborted) setState({ ...state, page });
    }); }}
    onCreate={(name) => {
      if (state.kind !== 'ready') return Promise.resolve(false);
      return run(async (service, signal) => {
        if (pendingCreate.current?.name !== name) pendingCreate.current = { name, id: crypto.randomUUID() };
        const saved = await service.events.create(name, pendingCreate.current.id, signal);
        if (!signal.aborted) {
          pendingCreate.current = null;
          setState({ ...state, page: { events: [saved, ...state.page.events.filter((event) => event.id !== saved.id)] } });
          setNotice('Event saved.');
        }
      });
    }}
  />;
}
