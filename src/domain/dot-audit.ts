import type { DotAward } from './dot-context.js';
import type { RoundGameDefinition } from './games.js';

export interface DotAwardAudit {
  readonly stringRulesVersion?: 2;
  readonly gameId: string;
  readonly kind: 'dots' | 'wolf' | 'churchy';
  readonly version: 1 | 2 | 3;
  readonly configuration: RoundGameDefinition;
  readonly gameEtag: string | null;
  readonly inputRevision: string | null;
  readonly before: readonly DotAward[];
  readonly after: readonly DotAward[];
}
