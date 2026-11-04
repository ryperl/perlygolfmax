import { createServer as createHttpServer } from 'node:http';
import { isValidElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { isRecord } from '../../src/contracts/events';

export async function renderComponentFixture(path: string, name: string, props: Readonly<Record<string, unknown>>): Promise<string> {
  const hmrServer = createHttpServer();
  const renderer = await createServer({
    server: { middlewareMode: true, hmr: { server: hmrServer }, watch: null }, appType: 'custom',
    logLevel: 'error', optimizeDeps: { noDiscovery: true },
  });
  let markup: string;
  try {
    const module: unknown = await renderer.ssrLoadModule(path);
    if (!isRecord(module) || typeof module[name] !== 'function') throw new Error('Fixture component export is missing.');
    const element: unknown = Reflect.apply(module[name], undefined, [props]);
    if (!isValidElement(element)) throw new Error('Fixture did not render a React element.');
    markup = renderToStaticMarkup(element);
  } finally {
    await renderer.close();
  }
  if (hmrServer.listening) throw new Error('SSR-only fixture unexpectedly opened a listener.');
  return markup;
}
