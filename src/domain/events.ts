export interface AccountIdentity {
  readonly tenantId: string;
  readonly objectId: string;
}

export type EventRole = 'owner' | 'member';

export interface GolfEvent {
  readonly id: string;
  readonly name: string;
  readonly createdAt: string;
}

export interface EventSummary extends GolfEvent {
  readonly role: EventRole;
}

export interface EventMembership {
  readonly eventId: string;
  readonly identity: AccountIdentity;
  readonly role: EventRole;
}

export interface EventCapabilities {
  readonly canCreateEvents: boolean;
}

export interface EventPage {
  readonly events: readonly EventSummary[];
  readonly continuationToken?: string;
}
