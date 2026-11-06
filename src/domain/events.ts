export interface AccountIdentity {
  readonly tenantId: string;
  readonly objectId: string;
}

export type EventRole = 'owner' | 'member' | 'viewer';
export type EventStatus = 'active' | 'archived';

export interface GolfEvent {
  readonly id: string;
  readonly name: string;
  readonly startDate?: string;
  readonly createdAt: string;
}

export interface EventSummary extends GolfEvent {
  readonly role: EventRole;
  readonly status: EventStatus;
  readonly etag: string;
}

export interface EventMembership {
  readonly eventId: string;
  readonly identity: AccountIdentity;
  readonly role: Exclude<EventRole, 'viewer'>;
}

export interface EventCapabilities {
  readonly canCreateEvents: boolean;
  readonly canManageCatalog: boolean;
}

export interface EventPage {
  readonly events: readonly EventSummary[];
  readonly continuationToken?: string;
}
