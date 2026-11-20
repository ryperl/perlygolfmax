import { createServer } from 'vite';
import type { Locator, Page, TestInfo } from '@playwright/test';
import { expect, test } from './test';
import { isHoleScore, isRoundScores } from '../../src/contracts/scoring';
import { isRecord } from '../../src/contracts/events';
import { isRoundGameDefinitions } from '../../src/contracts/games';
import { isEventWorkspace } from '../../src/contracts/setup';
import type { GameWriteResult, HoleScore, ScoreWriteResult } from '../../src/domain/scoring';
import { mergeNassauRecords, mergeWolfRecords } from '../../src/domain/game-declarations';
import { contrastRatio } from './contrast';
import { matchRound, matchWorkspace, withMatchResults, wolf } from './match-games-fixture-data';

async function openFixture(page: Page, testInfo: TestInfo, late = false, count: 9 | 18 = 18) {
  const server = await createServer({
    configFile: false, cacheDir: testInfo.outputPath('vite-cache'),
    server: { host: '127.0.0.1', port: 0, hmr: false }, esbuild: { jsx: 'automatic' },
    optimizeDeps: { noDiscovery: true, include: ['react', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime'] },
    logLevel: 'error',
  });
  let stored = matchRound(late, count);
  let writes = 0, reads = 0, configWrites = 0;
  const targets: string[] = [];
  expect(isRoundScores(stored)).toBe(true);
  expect(isEventWorkspace(matchWorkspace(stored))).toBe(true);
  try {
    await server.listen();
    const address = server.httpServer?.address();
    if (!address || typeof address === 'string') throw new Error('Fictional match-game server unavailable');
    const origin = `http://127.0.0.1:${String(address.port)}`;
    await page.route(`${origin}/`, (route) => route.fulfill({ contentType: 'text/html',
      body: '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="public-app-fixture"></div><script type="module" src="/tests/smoke/public-app-fixture.tsx"></script></body></html>' }));
    await page.route(`${origin}/__public-api/**`, async (route) => {
      const request = route.request(), headers = request.headers();
      expect(headers.authorization).toBeUndefined();
      const path = new URL(request.url()).pathname.replace('/__public-api/public/', '');
      if (request.method() === 'GET') {
        if (path === 'events') return route.fulfill({ json: { events: [matchWorkspace(stored).event] } });
        if (path.endsWith('/workspace')) return route.fulfill({ json: matchWorkspace(stored) });
        if (path.endsWith('/scores')) { reads++; return route.fulfill({ json: stored }); }
        throw new Error(`Unexpected fictional match read: ${path}`);
      }
      const payload: unknown = request.postDataJSON();
      const requestId = headers['idempotency-key'], expectedEtag = headers['if-match'] ?? null;
      if (!requestId || request.method() !== 'PUT' || !isRecord(payload)) throw new Error('Missing conditional fictional request');
      if (!path.includes('/holes/') && path.endsWith('/games')) {
        if (!isRoundGameDefinitions(payload.games) || !stored.games) throw new Error('Invalid fictional game setup');
        expect(expectedEtag).toBe(stored.games.configuration.etag);
        const before = stored.games.configuration.games;
        stored = withMatchResults({ ...stored, games: { ...stored.games,
          configuration: { ...stored.games.configuration, etag: `fictional-games-v${String(++configWrites + 1)}` } } }, payload.games);
        const result: GameWriteResult = { round: stored, change: { id: requestId, eventId: stored.eventId,
          roundId: stored.roundId, expectedEtag, before, after: payload.games, recordedAt: '2026-01-01T00:00:00Z',
          recordedBy: { kind: 'public-score', eventId: stored.eventId } } };
        expect(isRoundScores(stored)).toBe(true);
        return route.fulfill({ json: result });
      }
      if (!isHoleScore(payload.score)) throw new Error('Invalid fictional score write');
      const parts = path.split('/'), playerId = parts[5], holeNumber = Number(parts[7]);
      const card = stored.cards.find((entry) => entry.playerId === playerId);
      const before = card?.holes.find((hole) => hole.number === holeNumber)?.score;
      if (!card || !before) throw new Error('Unknown fictional score target');
      expect(expectedEtag).toBe(card.etag);
      if (card.etag === null) expect(headers['if-none-match']).toBe('*');
      if (payload.score.wolf?.length) expect(payload.score.wolf[0]?.choice.gameEtag).toBe(stored.games?.configuration.etag);
      const after: HoleScore = { ...payload.score,
        ...(payload.score.wolf || before.wolf ? { wolf: mergeWolfRecords(payload.score.wolf ?? [], before.wolf) } : {}),
        ...(payload.score.nassau || before.nassau ? { nassau: mergeNassauRecords(payload.score.nassau ?? [], before.nassau) } : {}),
      };
      targets.push(path);
      const recordedAt = '2026-01-01T00:00:00Z';
      stored = withMatchResults({ ...stored, setupLocked: true, lastUpdatedAt: recordedAt,
        cards: stored.cards.map((entry) => entry.playerId === playerId ? { ...entry,
          etag: `fictional-card-v${String(++writes + 1)}`, updatedAt: recordedAt,
          holes: entry.holes.map((hole) => hole.number === holeNumber ? { ...hole, score: after } : hole),
        } : entry) });
      const result: ScoreWriteResult = { round: stored, change: { id: requestId, eventId: stored.eventId,
        roundId: stored.roundId, playerId: card.playerId, holeNumber, before, after, expectedEtag, recordedAt,
        recordedBy: { kind: 'public-score', eventId: stored.eventId } } };
      expect(isRoundScores(stored)).toBe(true);
      return route.fulfill({ json: result });
    });
    await page.goto(`${origin}/#events?event=${stored.eventId}&round=${stored.roundId}`);
    await expect(page.getByRole('form', { name: `Group 1 hole ${count === 9 ? '17' : '1'} entry`, exact: true })).toBeVisible();
    return {
      close: () => server.close(),
      counters: () => ({ writes, reads, configWrites, targets }),
      peerRevision() {
        if (!stored.games) throw new Error('Missing fictional games');
        stored = withMatchResults({ ...stored, games: { ...stored.games,
          configuration: { ...stored.games.configuration, etag: 'fictional-peer-revision' } } });
      },
      unsupported() {
        const { supportedGameKinds: _support, ...legacy } = stored;
        expect(_support).toBeDefined();
        stored = legacy;
      },
      resolveSavedHole() {
        stored = withMatchResults({ ...stored, cards: stored.cards.map((card) => ({ ...card,
          holes: card.holes.map((hole) => hole.number === 1
            ? { ...hole, score: { ...hole.score, kind: 'strokes' as const, strokes: card.playerId === wolf.playerIds[0] ? 3 : 4 } } : hole),
        })) });
      },
    };
  } catch (error) { await server.close(); throw error; }
}

for (const count of [9, 18] as const) {
  test(`separate ${String(count)}-hole Match Play saves one stake and a two-down press without Nassau bets`, async ({ page }, testInfo) => {
    const fixture = await openFixture(page, testInfo, false, count);
    try {
      await page.setViewportSize({ width: 390, height: 900 });
      await page.getByRole('button', { name: 'Games', exact: true }).click();
      await page.getByRole('button', { name: 'Add game', exact: true }).click();
      const editor = page.getByRole('form', { name: 'Game settings' });
      await editor.getByRole('combobox', { name: 'Game type', exact: true }).selectOption('match-play');
      await editor.getByRole('combobox', { name: 'Playing group', exact: true }).selectOption('1');
      await editor.getByRole('combobox', { name: 'Score basis', exact: true }).selectOption('gross');
      await editor.getByRole('combobox', { name: 'Side A golfer 1', exact: true }).selectOption('00000000-0000-4000-8000-000000000001');
      await editor.getByRole('combobox', { name: 'Side B golfer 1', exact: true }).selectOption('00000000-0000-4000-8000-000000000002');
      await editor.getByRole('textbox', { name: 'Match stake per side · USD $', exact: true }).fill('1.01');
      await expect(editor.getByRole('textbox', { name: 'Front stake per side · USD $' })).toHaveCount(0);
      await editor.getByRole('button', { name: 'Save game', exact: true }).click();
      await expect(page.getByText('Game settings saved.', { exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Enter scores', exact: true }).click();
      const start = count === 9 ? 17 : 1;
      for (const hole of [start, start + 1]) {
        const form = page.getByRole('form', { name: `Group 1 hole ${String(hole)} entry`, exact: true });
        await form.getByRole('combobox', { name: `Side A vs Side B · Hole ${String(hole)}`, exact: true }).selectOption('side-a');
        for (const input of await form.locator('input[inputmode="numeric"]').all()) await input.fill('4');
        await form.getByRole('button', { name: 'Save & Next Hole', exact: true }).click();
      }
      const next = count === 9 ? 10 : 3;
      const form = page.getByRole('form', { name: `Group 1 hole ${String(next)} entry`, exact: true });
      await form.getByRole('button', { name: 'Stage manual press', exact: true }).click();
      for (const input of await form.locator('input[inputmode="numeric"]').all()) await input.fill('4');
      await form.getByRole('button', { name: 'Save & Next Hole', exact: true }).click();
      await expect(page.getByRole('heading', { name: `Hole ${String(next + 1)}`, exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Games', exact: true }).click();
      const board = page.getByRole('region', { name: 'Match Play matchboard', exact: true });
      await expect(board.getByText('Match', { exact: true })).toBeVisible();
      await expect(board.getByText('Match · manual press', { exact: true })).toBeVisible();
      await expect(board.getByText('Front', { exact: true })).toHaveCount(0);
      await expect(board.getByText('Back', { exact: true })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Edit Match Play', exact: true })).toBeDisabled();
      expect(fixture.counters().configWrites).toBe(1);
      expect(fixture.counters().targets.filter((path) => path.endsWith('/games'))).toHaveLength(3);
      const savedReads = fixture.counters().reads;
      await page.getByRole('button', { name: 'Scorecards', exact: true }).click();
      await page.setViewportSize({ width: 320, height: 900 });
      await page.evaluate((theme) => {
        document.documentElement.dataset.theme = theme;
        document.documentElement.style.fontSize = '125%';
      }, count === 9 ? 'dark' : 'light');
      const positions = page.getByRole('region', { name: 'Match Play match positions', exact: true });
      await expect(positions.getByText('Fictional golfer 1 2 UP', { exact: true })).toBeVisible();
      await expect(positions.getByText(`Thru 3 · ${String(count - 3)} holes to play`, { exact: true })).toBeVisible();
      await expect(page.getByRole('cell', { name: `Fictional golfer 1, after hole ${String(start)} match position vs Fictional golfer 2: 1 up`, exact: true })).toHaveText('1 UP');
      await expect(page.getByRole('cell', { name: `Fictional golfer 2, after hole ${String(next)} match position vs Fictional golfer 1: 2 down`, exact: true })).toHaveText('2 DN');
      await expect(page.getByRole('cell', { name: `Fictional golfer 1, after hole ${String(next + 1)} match position vs Fictional golfer 2: pending`, exact: true })).toHaveText('—');
      const table = page.getByRole('table', { name: count === 9 ? 'Back nine scorecard' : 'Front nine scorecard', exact: true });
      if (count === 9) await expect(page.getByRole('table', { name: 'Front nine scorecard' })).toHaveCount(0);
      await table.getByRole('button', { name: 'Open scorecard for Fictional golfer 2', exact: true }).click();
      await expect(positions.getByText('2 DN', { exact: true })).toBeVisible();
      await expect(page.getByRole('row', { name: /Fictional golfer 1 · Match Play match position/ })).toHaveCount(0);
      expect(fixture.counters().reads).toBe(savedReads);
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath('match-play-scorecard.png'), fullPage: true });
      await page.getByRole('combobox', { name: 'Game', exact: true }).selectOption('');
      await expect(positions).toHaveCount(0);
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    } finally { await fixture.close(); }
  });
}

async function narrowControls(page: Page, scope: Locator) {
  for (const select of await scope.getByRole('combobox').all()) {
    const style = await select.evaluate((element) => {
      const computed = getComputedStyle(element);
      const label = element.closest('label');
      return { height: element.getBoundingClientRect().height, color: computed.color, background: computed.backgroundColor,
        fits: label !== null && label.scrollWidth <= label.clientWidth, tag: element.tagName,
        label: label?.firstChild?.textContent, labelWidth: label?.clientWidth, labelScrollWidth: label?.scrollWidth };
    });
    expect(style.tag).toBe('SELECT');
    expect(style.height).toBeGreaterThanOrEqual(44);
    expect(style.fits, JSON.stringify(style)).toBe(true);
    expect(contrastRatio(style.color, style.background)).toBeGreaterThanOrEqual(4.5);
  }
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

for (const theme of ['light', 'dark']) {
  test(`Nassau and Wolf setup, declaration placement and saved-only results at narrow ${theme}`, async ({ page }, testInfo) => {
    test.setTimeout(30000);
    const fixture = await openFixture(page, testInfo);
    try {
      await page.setViewportSize({ width: 320, height: 900 });
      await page.evaluate((value) => { document.documentElement.dataset.theme = value; document.documentElement.style.fontSize = '125%'; }, theme);
      await page.getByRole('button', { name: 'Games', exact: true }).click();
      await page.getByRole('button', { name: 'Add game', exact: true }).click();
      const editor = page.getByRole('form', { name: 'Game settings', exact: true });
      await editor.getByRole('combobox', { name: 'Game type', exact: true }).selectOption('wolf');
      await editor.getByRole('combobox', { name: 'Playing group', exact: true }).selectOption('1');
      await editor.getByRole('combobox', { name: 'Wolf P1', exact: true }).selectOption(wolf.playerIds[0] ?? '');
      await editor.getByRole('combobox', { name: 'Score basis', exact: true }).selectOption('gross');
      await editor.getByLabel('Allow PIG', { exact: true }).check();
      await narrowControls(page, editor);
      await editor.getByRole('button', { name: 'Save game', exact: true }).click();
      await expect(page.getByText('Game settings saved.', { exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Add game', exact: true }).click();
      await editor.getByRole('combobox', { name: 'Game type', exact: true }).selectOption('nassau');
      await editor.getByRole('combobox', { name: 'Playing group', exact: true }).selectOption('1');
      await editor.getByRole('combobox', { name: 'Score basis', exact: true }).selectOption('gross');
      await editor.getByRole('combobox', { name: 'Nassau format', exact: true }).selectOption('two-v-two-best-ball');
      for (const [index, playerId] of wolf.playerIds.entries()) {
        await editor.getByRole('combobox', { name: `Side ${index < 2 ? 'A' : 'B'} golfer ${String(index % 2 + 1)}`, exact: true }).selectOption(playerId);
      }
      await editor.getByRole('button', { name: 'No planned money', exact: true }).click();
      await editor.getByLabel('Front stake per side · USD $', { exact: true }).fill('1.01');
      await narrowControls(page, editor);
      await editor.getByRole('button', { name: 'Save game', exact: true }).click();
      await expect(page.getByText('Game settings saved.', { exact: true })).toBeVisible();
      expect(fixture.counters().configWrites).toBe(2);
      await page.getByRole('button', { name: 'Enter scores', exact: true }).click();
      const form = page.getByRole('form', { name: 'Group 1 hole 1 entry', exact: true });
      const controls = form.locator('.round-game-hole-controls');
      expect(await form.evaluate((element) => element.querySelector('form'))).toBeNull();
      const wolfControls = form.getByRole('group', { name: 'Wolf · Hole 1', exact: true });
      const nassauControls = form.getByRole('group', { name: 'Nassau · Match outcomes and presses', exact: true });
      expect(await wolfControls.evaluate((element) => {
        const scores = element.closest('form')?.querySelector('.group-entry-rows');
        return !!scores && (element.compareDocumentPosition(scores) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
      })).toBe(true);
      expect((await wolfControls.boundingBox())?.height).toBeLessThanOrEqual(350);
      expect(await nassauControls.evaluate((element) => {
        const scores = element.closest('form')?.querySelector('.group-entry-rows');
        return !!scores && (scores.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
      })).toBe(true);
      await narrowControls(page, controls);
      if (testInfo.project.name === 'iphone-16-pro-webkit') {
        await form.getByRole('combobox', { name: 'Wolf declaration', exact: true })
          .evaluate((element) => { element.scrollIntoView({ block: 'center' }); });
        await expect.poll(() => form.getByRole('combobox', { name: 'Wolf declaration', exact: true }).evaluate((element) => {
          const box = element.getBoundingClientRect();
          return document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2) === element;
        })).toBe(true);
        await wolfControls.screenshot({ path: `coverage/wolf-declaration-${theme}-phone.png` });
      }
      await expect(form.locator('button[type="submit"], button:not([type])')).toHaveCount(1);
      await form.getByRole('combobox', { name: 'Wolf declaration', exact: true }).selectOption('pig');
      await form.getByRole('combobox', { name: 'Side A vs Side B · Hole 1', exact: true }).selectOption('side-a');
      expect(fixture.counters().writes).toBe(0);
      await page.getByRole('button', { name: 'Games', exact: true }).click();
      const openWolf = async () => {
        const summary = page.getByText('Wolf · Game standings', { exact: true });
        if (!await summary.evaluate((element) => {
          const details = element.closest('details');
          if (!details) throw new Error('Missing Wolf standings disclosure');
          return details.open;
        })) await summary.click();
      };
      await openWolf();
      const wolfResults = page.getByRole('region', { name: 'Wolf results', exact: true });
      await expect(wolfResults.getByRole('cell', { name: '3', exact: true })).toHaveCount(0);
      await expect(page.getByRole('region', { name: 'Nassau matchboard', exact: true })).toContainText('0 resolved / 9 remaining');
      await page.getByRole('button', { name: 'Refresh saved round', exact: true }).click();
      await openWolf();
      await expect(wolfResults.getByRole('columnheader', { name: 'Earned dots', exact: true })).toBeVisible();
      await expect(wolfResults.getByRole('columnheader', { name: 'Lost', exact: true })).toHaveCount(0);
      expect(fixture.counters().writes).toBe(0);
      await page.getByRole('button', { name: 'Enter scores', exact: true }).click();
      await expect(form.getByRole('combobox', { name: 'Wolf declaration', exact: true })).toHaveValue('pig');
      const scores = form.locator('input[inputmode="numeric"]');
      await expect(scores).toHaveCount(4);
      for (const input of await scores.all()) await input.fill('4');
      await form.getByRole('button', { name: 'Save & Next Hole', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Hole 2', exact: true })).toBeVisible();
      expect(fixture.counters().writes).toBe(4);
      expect(fixture.counters().targets.filter((path) => path.endsWith('/games'))).toHaveLength(1);
      await page.getByRole('button', { name: 'Previous hole', exact: true }).click();
      await expect(form.getByRole('combobox', { name: 'Wolf declaration', exact: true })).toBeDisabled();
      await expect(form.getByRole('combobox', { name: 'Wolf match outcome', exact: true })).toHaveCount(0);
      await page.getByRole('button', { name: 'Games', exact: true }).click();
      await openWolf();
      await expect(wolfResults.getByRole('cell', { name: '3', exact: true })).toHaveCount(0);
      fixture.resolveSavedHole();
      await expect(wolfResults.getByRole('cell', { name: '3', exact: true })).toHaveCount(0);
      await page.getByRole('button', { name: 'Refresh saved round', exact: true }).click();
      await openWolf();
      await expect(wolfResults.getByRole('cell', { name: '3', exact: true })).toHaveCount(1);
      await page.getByRole('button', { name: 'Leaderboard', exact: true }).click();
      await page.getByRole('combobox', { name: 'Leaderboard game', exact: true }).selectOption({ index: 0 });
      await expect(page.getByLabel('3 earned dots', { exact: true })).toBeVisible();
      await narrowControls(page, page.getByRole('region', { name: 'Round leaderboard', exact: true }));
    } finally { await fixture.close(); }
  });
}

test('saved late Wolf decisions stay read-only, corrections use peer revision, and old APIs disable match declarations', async ({ page }, testInfo) => {
  test.setTimeout(30000);
  const fixture = await openFixture(page, testInfo, true);
  try {
    const form = page.getByRole('form', { name: 'Group 1 hole 1 entry', exact: true });
    await expect(form.getByRole('combobox', { name: 'Wolf declaration', exact: true })).toHaveValue('pig');
    await expect(form.getByRole('combobox', { name: 'Wolf declaration', exact: true })).toBeDisabled();
    await expect(form.getByText('Choice recorded after scores were saved. Tee-shot timing was not verified.')).toBeVisible();
    fixture.peerRevision();
    await page.getByRole('button', { name: 'Refresh saved round', exact: true }).click();
    await expect(form.getByRole('combobox', { name: 'Wolf match outcome', exact: true })).toBeEnabled();
    await form.getByRole('combobox', { name: 'Wolf match outcome', exact: true }).selectOption('halved');
    await form.getByRole('button', { name: 'Save & Next Hole', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Hole 2', exact: true })).toBeVisible();
    expect(fixture.counters().writes).toBe(1);
    await page.getByRole('button', { name: 'Previous hole', exact: true }).click();
    await expect(form.getByRole('combobox', { name: 'Wolf declaration', exact: true })).toBeDisabled();
    await expect(form.getByText('Choice recorded after scores were saved. Tee-shot timing was not verified.')).toBeVisible();
    await page.getByRole('button', { name: 'Games', exact: true }).click();
    const results = page.getByRole('region', { name: 'Fictional Wolf results', exact: true });
    await expect(results.getByText('Saved hole choices and winners', { exact: true })).toHaveCount(0);
    await expect(results.getByRole('columnheader', { name: 'Dot balance', exact: true })).toBeVisible();
    fixture.unsupported();
    await page.getByRole('button', { name: 'Refresh saved round', exact: true }).click();
    await expect(page.getByText('This API does not advertise support for editing this game.')).toHaveCount(2);
    await page.getByRole('button', { name: 'Add game', exact: true }).click();
    const editor = page.getByRole('form', { name: 'Game settings', exact: true });
    for (const kind of ['stroke-play', 'wolf', 'nassau']) await expect(editor.locator(`option[value="${kind}"]`)).toHaveJSProperty('disabled', true);
    await editor.getByRole('button', { name: 'Cancel editing', exact: true }).click();
    await page.getByRole('button', { name: 'Enter scores', exact: true }).click();
    await expect(form.getByRole('combobox', { name: 'Wolf match outcome', exact: true })).toBeDisabled();
    await expect(form.getByText('Wolf declarations unavailable: API support is required.')).toBeVisible();
    await expect(form.getByText('Nassau declarations unavailable: API support is required.')).toBeVisible();
    expect(fixture.counters().writes).toBe(1);
  } finally { await fixture.close(); }
});
