import { expect, test } from '@playwright/test';

test('production shell supports navigation, history, and keyboard access', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => { errors.push(error.message); });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Events');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('main')).toBeFocused();
  await page.getByRole('link', { name: 'Preview', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('The Coastal Classic');
  await page.getByRole('link', { name: 'Explore the rounds' }).click();
  await expect(page.getByRole('listitem')).toHaveCount(5);
  await page.getByRole('link', { name: 'Demo group' }).click();
  await expect(page.getByRole('listitem')).toHaveCount(12);
  await page.goBack();
  await expect(page.getByRole('link', { name: 'Demo rounds', exact: true })).toHaveAttribute('aria-current', 'page');
  await page.getByRole('link', { name: 'Events', exact: true }).click();
  if (process.env.EXPECT_EVENT_SERVICES_CONFIGURED === 'true') {
    await expect(page.getByRole('banner').getByRole('button', { name: 'Sign in', exact: true })).toBeEnabled();
  } else {
    await expect(page.getByRole('heading', { name: 'Event services are not configured' })).toBeVisible();
    await expect(page.getByRole('banner').getByRole('button', { name: 'Sign in', exact: true })).toBeDisabled();
  }
  await page.goto('/#unknown');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Events');
  expect(errors).toEqual([]);
});

test('every page fits a narrow viewport and enlarged text', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  for (const hash of ['events', 'overview', 'rounds', 'group', 'preview', 'preview?view=rounds', 'preview?view=group']) {
    await page.goto(`/#${hash}`);
    await page.evaluate(() => { document.documentElement.style.fontSize = '125%'; });
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const account = page.getByRole('banner').getByRole('button', { name: 'Sign in', exact: true });
    await expect(account).toBeVisible();
    await expect(page.getByRole('button', { name: /^Sign (in|out)$/ })).toHaveCount(1);
    const brandBounds = await page.getByRole('link', { name: 'Perly Golf Max home' }).boundingBox();
    const accountBounds = await account.boundingBox();
    expect(brandBounds).not.toBeNull();
    expect(accountBounds).not.toBeNull();
    if (brandBounds && accountBounds) {
      expect(accountBounds.y >= brandBounds.y + brandBounds.height || accountBounds.x >= brandBounds.x + brandBounds.width).toBe(true);
      expect(accountBounds.x + accountBounds.width).toBeLessThanOrEqual(320);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
});

test('manifest and correctly sized icons are served without service-worker claims', async ({ page, request }) => {
  await page.goto('/');
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/manifest.webmanifest');
  const response = await request.get('/manifest.webmanifest');
  expect(response.ok()).toBe(true);
  const manifest: unknown = await response.json();
  expect(manifest).toMatchObject({
    name: 'Perly Golf Max',
    start_url: '/',
    display: 'standalone',
    icons: expect.arrayContaining([
      expect.objectContaining({ src: '/icons/icon-192.png', sizes: '192x192' }),
      expect.objectContaining({ src: '/icons/icon-maskable-512.png', purpose: 'maskable' }),
    ]),
  });
  for (const [file, size] of [['icon-192.png', 192], ['icon-512.png', 512], ['icon-maskable-512.png', 512], ['apple-touch-icon.png', 180]] as const) {
    const icon = await request.get(`/icons/${file}`);
    expect(icon.ok()).toBe(true);
    expect(icon.headers()['content-type']).toContain('image/png');
    const bytes = await icon.body();
    expect(bytes.readUInt32BE(16)).toBe(size);
    expect(bytes.readUInt32BE(20)).toBe(size);
  }
  expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length)).toBe(0);
});

test('theme supports system preference and explicit preview overrides', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.goto('/?clawpilotTheme=light');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/?clawpilotTheme=invalid');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});
