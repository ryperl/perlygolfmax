import { HttpRequest } from '@azure/functions';
import { describe, expect, it } from 'vitest';
import { leanScoresFixture } from '../../../src/contracts/lean-round-scores.test-support.js';
import { leanRoundScores } from '../../../src/contracts/lean-round-scores.js';
import { decodeRoundScores } from '../../../src/contracts/scoring.js';
import { isRecord } from '../../../src/contracts/events.js';
import { maximumInlineReadBytes, privateReadResponse } from '../private-transport.js';

describe('lean score read budget', () => {
  it.each([4, 12] as const)('keeps the same evidence-heavy fictional %i-player round inline instead of paging, without increasing the threshold', (players) => {
    const round = leanScoresFixture(players);
    const request = new HttpRequest({ method: 'GET', url: 'https://fictional.example.test/api/scores?format=lean' });
    const legacy = privateReadResponse(request, round);
    expect(isRecord(legacy) && isRecord(legacy.privateRead) && legacy.privateRead.parts).toBeGreaterThan(1);
    const wire = leanRoundScores(round);
    expect(Buffer.byteLength(JSON.stringify(wire))).toBeLessThanOrEqual(maximumInlineReadBytes);
    const value = privateReadResponse(request, wire);
    expect(value).toBe(wire);
    expect(decodeRoundScores(value)).toEqual(round);
  });
});
