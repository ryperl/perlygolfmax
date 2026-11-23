import { describe, expect, it } from 'vitest';
import { gameDisplayName, gameScoringLabel, gameUnavailableMessage } from './game-presentation';
import { churchyFixture } from '../../domain/churchy.test-support';
import type { RoundGameDefinition } from '../../domain/games';
import { stablefordPoints } from '../../domain/stableford';

describe('shared game availability copy', () => {
  it('shows custom Churchie names while normalizing only historical default spellings', () => {
    const game = churchyFixture().game;
    for (const name of ['Churchie', 'Churchy Game']) {
      expect(gameDisplayName({ ...game, name })).toBe('Churchie');
    }
    expect(gameDisplayName({ ...game, version: 3 as const, name: 'Churcie', orderMode: 'tee' as const, specials: [] })).toBe('Churchie');
    expect(gameDisplayName({ ...game, version: 3 as const, name: 'Churchy Game', orderMode: 'tee' as const, specials: [] })).toBe('Churchy Game');
    expect(gameDisplayName({ ...game, name: 'Churcie' })).toBe('Churcie');
    expect(gameDisplayName({ ...game, name: 'Fictional evening game' })).toBe('Fictional evening game');
  });

  it('distinguishes missing handicap inputs from pending or zero points', () => {
    expect(gameUnavailableMessage('missing-handicap-index')).toBe('No captured Handicap Index is available.');
    expect(gameUnavailableMessage('missing-tee-ratings')).toBe('Tee ratings are unavailable.');
    expect(gameUnavailableMessage('missing-stroke-index')).toBe('Hole stroke indexes are unavailable.');
    expect(gameUnavailableMessage('invalid-handicap-index')).toBe('The captured Handicap Index cannot be used.');
    expect(gameUnavailableMessage(undefined)).toBe('Score data is unavailable.');
  });
  it('uses the same preset/custom labels on game cards and leaderboards', () => {
    const game: RoundGameDefinition = {
      id: '00000000-0000-4000-8000-000000000001', name: 'Fictional game', preset: 'standard', basis: 'gross',
      handicapAllowancePercent: 95, points: stablefordPoints('standard'),
    };
    expect(gameScoringLabel(game)).toBe('Standard Stableford · Gross');
    expect(gameScoringLabel({ ...game, preset: 'modified', points: stablefordPoints('modified') })).toBe('Modified Stableford · Gross');
    expect(gameScoringLabel({ ...game, points: { ...game.points, betterScorePoints: 99 } })).toBe('Standard Stableford · Custom points · Gross');
    expect(gameScoringLabel({ ...game, basis: 'net', handicapAllowancePercent: 100 })).toBe('Standard Stableford · Net · 100% allowance');
    for (const [format, label] of [['two-net-better-ball', '2-man net Better Ball'], ['two-net-aggregate', '2-man net Aggregate'], ['four-two-net', '4-man 2-net Stableford']] as const) {
      expect(gameScoringLabel({ ...game, basis: 'net', format, teams: [] })).toBe(`${label} · Standard Stableford · Net · 95% allowance`);
    }
  });
});
