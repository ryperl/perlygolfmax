import { describe, expect, it } from 'vitest';
import { playerInitials } from './player-initials';

function shortNames(...displayNames: string[]): string[] {
  const players = displayNames.map((displayName, index) => ({ playerId: `p${String(index)}`, displayName }));
  const result = playerInitials(players);
  return players.map((player) => result.get(player.playerId) ?? '');
}

describe('player initials for compact views', () => {
  it('uses upper-case given and family initials', () => {
    expect(shortNames('Rory Pine', 'alex quill')).toEqual(['RP', 'AQ']);
  });

  it('reads "Last, First", ignores suffixes and keeps a single name to one letter', () => {
    expect(shortNames('Pine, Rory', 'Sam Oak Jr.', 'Cedar')).toEqual(['RP', 'SO', 'C']);
  });

  it('adds family-name letters only for golfers who clash', () => {
    expect(shortNames('Rory Pine', 'Rob Palm', 'Alex Quill')).toEqual(['RPi', 'RPa', 'AQ']);
    expect(shortNames('Rory Pinecone', 'Rob Pinewood')).toEqual(['RPinec', 'RPinew']);
  });

  it('numbers golfers with identical names in the order shown', () => {
    expect(shortNames('Rory Pine', 'Rory Pine', 'Alex Quill')).toEqual(['RPine1', 'RPine2', 'AQ']);
  });

  it('keeps numbered fictional golfers distinct and handles accented letters', () => {
    expect(shortNames('Fictional golfer 1', 'Fictional golfer 2')).toEqual(['F1', 'F2']);
    expect(shortNames('Émile Ångström')).toEqual(['ÉÅ']);
  });
});
