import type { ChurchyGameDefinitionV2, ChurchySpecialsV2 } from './churchy.js';
import { churchyFixture } from './churchy.test-support.js';

export function churchyV2Fixture(count: 9 | 18 = 9) {
  const fixture = churchyFixture(count);
  const game: ChurchyGameDefinitionV2 = { ...fixture.game, version: 2,
    enabledSpecials: ['paree', 'murphy', 'sandy', 'pully', 'birdie', 'eagle', 'sticky', 'sweep'] };
  const extras: ChurchySpecialsV2 = { version: 2, gameId: game.id, gameEtag: fixture.extras.gameEtag,
    paree: false, murphy: false, murphyPresses: 0, sandyCount: 0, pully: false, sticky: false, otherDots: 0 };
  return { ...fixture, game, extras };
}
