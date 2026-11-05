import { expect, test as base } from '@playwright/test';

export const test = base.extend({
  page: async ({ page }, runFixture) => {
    await page.route('**/*', (route) => {
      const url = new URL(route.request().url());
      if (['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
        || url.protocol === 'data:' || url.protocol === 'blob:') return route.continue();
      if (url.pathname.endsWith('/public/events') && route.request().method() === 'GET') {
        return route.fulfill({ json: { events: [] }, headers: { 'Access-Control-Allow-Origin': '*' } });
      }
      return route.abort('blockedbyclient');
    });
    await runFixture(page);
  },
});
export { expect };
