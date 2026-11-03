export interface Golfer {
  readonly id: string;
  readonly displayName: string;
}

export interface Round {
  readonly id: string;
  readonly number: number;
  readonly courseName: string;
  readonly dayLabel: string;
  readonly teeTimeLabel: string;
}

export interface Trip {
  readonly id: string;
  readonly name: string;
  readonly locationLabel: string;
  readonly dateLabel: string;
  readonly golfers: readonly Golfer[];
  readonly rounds: readonly Round[];
}
