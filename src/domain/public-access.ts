export interface PublicScoreIdentity {
  readonly kind: 'public-score';
  readonly eventId: string;
}

export interface PublicBrowseIdentity {
  readonly kind: 'public-browse';
}
