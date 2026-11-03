import { describe, expect, it } from 'vitest';
import { demoTrip } from './trip';

describe('fictional trip fixture', () => {
  it('contains exactly twelve uniquely identified fictional golfers and five ordered rounds', () => {
    expect(demoTrip.golfers).toHaveLength(12);
    expect(demoTrip.rounds).toHaveLength(5);
    expect(new Set(demoTrip.golfers.map(({ id }) => id)).size).toBe(12);
    expect(new Set(demoTrip.rounds.map(({ id }) => id)).size).toBe(5);
    expect(demoTrip.rounds.map(({ number }) => number)).toEqual([1, 2, 3, 4, 5]);
    for (const golfer of demoTrip.golfers) {
      expect(golfer.displayName.trim()).not.toBe('');
      expect(Object.keys(golfer).sort()).toEqual(['displayName', 'id']);
    }
  });

  it('does not silently add scoring, personal contact, or pairing fields', () => {
    expect(Object.keys(demoTrip).sort()).toEqual(['dateLabel', 'golfers', 'id', 'locationLabel', 'name', 'rounds']);
    for (const round of demoTrip.rounds) {
      expect(Object.keys(round).sort()).toEqual(['courseName', 'dayLabel', 'id', 'number', 'teeTimeLabel']);
    }
  });
});
