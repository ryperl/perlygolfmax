import { describe, expect, it } from 'vitest';
import { gameUnavailableMessage } from './game-presentation';

describe('shared game availability copy', () => {
  it('distinguishes missing handicap inputs from pending or zero points', () => {
    expect(gameUnavailableMessage('missing-handicap-index')).toBe('No captured Handicap Index is available.');
    expect(gameUnavailableMessage('missing-tee-ratings')).toBe('Tee ratings are unavailable.');
    expect(gameUnavailableMessage('missing-stroke-index')).toBe('Hole stroke indexes are unavailable.');
    expect(gameUnavailableMessage('invalid-handicap-index')).toBe('The captured Handicap Index cannot be used.');
    expect(gameUnavailableMessage(undefined)).toBe('Score data is unavailable.');
  });
});
