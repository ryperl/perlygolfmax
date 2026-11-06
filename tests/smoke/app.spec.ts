import { inflateSync } from 'node:zlib';
import { expect, test } from './test';

function contrastRatio(first: string, second: string): number {
  function luminance(color: string): number {
    const channels = color.match(/\d+/g)?.map(Number);
    if (!channels || channels.length !== 3) throw new Error(`Expected an opaque RGB color: ${color}`);
    return channels.reduce((total, channel, index) => {
      const value = channel / 255;
      const linear = value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      return total + linear * (index === 0 ? 0.2126 : index === 1 ? 0.7152 : 0.0722);
    }, 0);
  }
  const firstLuminance = luminance(first);
  const secondLuminance = luminance(second);
  return (Math.max(firstLuminance, secondLuminance) + 0.05) / (Math.min(firstLuminance, secondLuminance) + 0.05);
}

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
  await expect(page.getByRole('link', { name: 'Organizer tools', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Sign (in|out)$/ })).toHaveCount(0);
  if (process.env.EXPECT_PUBLIC_SERVICES_CONFIGURED !== 'true' && process.env.EXPECT_EVENT_SERVICES_CONFIGURED !== 'true') {
    await expect(page.getByRole('heading', { name: 'Event services are not configured' })).toBeVisible();
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
    const account = page.getByRole('banner').getByRole('link', { name: 'Organizer tools', exact: true });
    await expect(account).toBeVisible();
    await expect(page.getByRole('button', { name: /^Sign (in|out)$/ })).toHaveCount(0);
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
    background_color: '#f3f6f3',
    theme_color: '#f3f6f3',
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
    expect(bytes[24]).toBe(8);
    expect(bytes[25]).toBe(2);
    expect(bytes.subarray(37, 41).toString()).toBe('IDAT');
    const pixels = inflateSync(bytes.subarray(41, 41 + bytes.readUInt32BE(33)));
    const stride = size * 3 + 1;
    expect(pixels.length).toBe(stride * size);
    expect(pixels[0]).toBe(0);
    expect([...pixels.subarray(1, 4)]).toEqual([20, 92, 61]);
    const poleRow = Math.floor(size * 0.4) * stride;
    const polePixel = poleRow + 1 + Math.floor(size * 0.49) * 3;
    expect(pixels[poleRow]).toBe(0);
    expect([...pixels.subarray(polePixel, polePixel + 3)]).toEqual([255, 255, 255]);
  }
  const favicon = await request.get('/icons/icon.svg');
  expect(favicon.ok()).toBe(true);
  expect(await favicon.text()).toMatch(/<rect[^>]+fill="#145c3d"/);
  expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length)).toBe(0);
});

for (const palette of [
  { theme: 'light', background: 'rgb(243, 246, 243)', accent: 'rgb(20, 92, 61)', hover: 'rgb(14, 68, 45)', gold: 'rgb(132, 99, 28)', chrome: '#f3f6f3' },
  { theme: 'dark', background: 'rgb(21, 32, 25)', accent: 'rgb(128, 205, 165)', hover: 'rgb(160, 223, 189)', gold: 'rgb(225, 193, 116)', chrome: '#152019' },
] as const) {
  test(`forest palette keeps ${palette.theme} text, actions and keyboard focus readable`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: palette.theme });
    await page.goto('/#preview');
    await expect(page.locator('html')).toHaveAttribute('data-theme', palette.theme);
    await expect(page.locator('body')).toHaveCSS('background-color', palette.background);
    await expect(page.locator(`meta[name="theme-color"][media="(prefers-color-scheme: ${palette.theme})"]`))
      .toHaveAttribute('content', palette.chrome);
    const primary = page.getByRole('link', { name: 'Explore the rounds' });
    await expect(primary).toHaveCSS('background-color', palette.accent);
    await expect(page.locator('.hero .eyebrow')).toHaveCSS('color', palette.gold);
    const colors = await page.evaluate(() => {
      function style(selector: string) {
        const element = document.querySelector(selector);
        if (!element) throw new Error(`Missing palette sample: ${selector}`);
        return getComputedStyle(element);
      }
      return {
        text: style('body').color,
        background: style('body').backgroundColor,
        primaryText: style('.primary-link').color,
        primaryBackground: style('.primary-link').backgroundColor,
        gold: style('.hero .eyebrow').color,
        muted: style('.hero-description').color,
        hero: style('.hero').backgroundColor,
      };
    });
    expect(contrastRatio(colors.text, colors.background)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(colors.primaryText, colors.primaryBackground)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(colors.gold, colors.hero)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(colors.muted, colors.hero)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(palette.accent, colors.hero)).toBeGreaterThanOrEqual(3);
    await primary.hover();
    await expect(primary).toHaveCSS('background-color', palette.hover);
    expect(contrastRatio(colors.primaryText, palette.hover)).toBeGreaterThanOrEqual(4.5);
    await page.keyboard.press('Tab');
    await primary.focus();
    await expect(primary).toBeFocused();
    await expect(primary).toHaveCSS('outline-style', 'solid');
    await expect(primary).toHaveCSS('outline-color', palette.accent);
    await expect(primary).toHaveCSS('outline-width', '3px');
  });
}

test('theme supports system preference and explicit preview overrides', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.goto('/?clawpilotTheme=light');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(243, 246, 243)');
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/?clawpilotTheme=dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(21, 32, 25)');
  await page.goto('/?clawpilotTheme=invalid');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});
