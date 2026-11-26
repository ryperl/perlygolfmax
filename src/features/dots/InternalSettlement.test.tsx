import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { InternalGameSettlement, InternalSettlementPlayer } from '../../domain/dot-settlement';
import { InternalSettlement } from './InternalSettlement';

function player(playerId: string, displayName: string, totalDots: number): InternalSettlementPlayer {
  return { playerId, displayName, baseDots: 0, specialDots: totalDots, totalDots, netMinor: null };
}

/** Two fictional golfers share a name; the second saved one has more dots, so it ranks first. */
function settlement(): InternalGameSettlement {
  return { version: 1, groupNumber: 1, gameIds: ['fictional-dots'], currency: 'USD', stakeMinor: null,
    status: 'points-only', totalToSettleMinor: null, pairwise: [],
    players: [player('a', 'Rory Pine', 1), player('b', 'Rory Pine', 5), player('c', 'Alex Quill', 3)] };
}

function shownInitials(container: HTMLElement): (string | undefined)[] {
  return [...container.querySelectorAll<HTMLElement>('[data-initials]')].map((element) => element.dataset.initials);
}

describe('internal settlement names', () => {
  it('numbers golfers with identical names in the ranked order shown', () => {
    const { container } = render(<InternalSettlement settlement={settlement()} ranked />);
    expect(shownInitials(container)).toEqual(['RPine1', 'AQ', 'RPine2']);
  });

  it('numbers them in saved order when the list is not ranked', () => {
    const { container } = render(<InternalSettlement settlement={settlement()} />);
    expect(shownInitials(container)).toEqual(['RPine1', 'RPine2', 'AQ']);
  });
});
