export type ScoreView = 'entry' | 'cards' | 'games' | 'leaderboard';

export interface ScoreLocation {
  readonly groupNumber: number;
  readonly holeNumber: number;
  readonly view: ScoreView;
}

export interface SavedScoreLocation extends ScoreLocation {
  readonly version: 1;
  readonly eventId: string;
  readonly roundId: string;
}
