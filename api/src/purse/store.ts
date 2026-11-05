import type { TableClient } from '@azure/data-tables';
import type { AccountIdentity } from '../../../src/domain/events.js';
import type { PublicScoreIdentity } from '../../../src/domain/public-access.js';
import type { PursePlan, PurseTieResolution } from '../../../src/domain/purse.js';
import { calculatePurse, samePursePlan, samePurseTieResolutions } from '../../../src/domain/purse.js';
import type { EventPurseView, PurseChange, PurseConfiguration, PurseWriteResult } from '../../../src/domain/purse-settings.js';
import type { RoundScores } from '../../../src/domain/scoring.js';
import { isEventRevision, isRecord, isUuid } from '../../../src/contracts/events.js';
import { isPursePlanForWorkspace, isPurseTieResolutions } from '../../../src/contracts/purse.js';
import { isPurseChange, isPurseConfiguration } from '../../../src/contracts/purse-settings.js';
import { isPrivateUpload, maximumPrivateWriteBytes } from '../../../src/contracts/private-values.js';
import { canonical, decode, isConflict, optionalRow, revision } from '../catalog/entities.js';
import { ApiError } from '../errors.js';
import { privateContent, stagePrivateContent } from '../private-values.js';
import { receivePrivateWrite } from '../private-transport.js';
import type { StagedPublication } from '../private-transport.js';
import type { TableWorkspaceStore } from '../setup/store.js';
import type { TableScoreStore } from '../scoring/store.js';
import { assertEventAccessUnchanged, readEventAccess } from '../event-access.js';
import type { EventAccess } from '../event-access.js';

const configurationKey = 'purse';
const changeKey = (id: string) => `purse-change:${id}`;

export class TablePurseStore {
  constructor(private readonly table: TableClient, private readonly workspace: TableWorkspaceStore,
    private readonly scores: TableScoreStore) {}

  private async access(identity: AccountIdentity | PublicScoreIdentity, eventId: string, ownerOnly = false) {
    if (!isUuid(eventId)) throw new ApiError(400, 'INVALID_REQUEST_ID');
    const access = await readEventAccess(this.table, identity, eventId);
    if (access.summary.role !== 'owner' && (ownerOnly || !access.admittedPlayer && !access.publicAccess)) throw new ApiError(403, 'PURSE_OWNER_REQUIRED');
    return access;
  }

  private ownerGrant(access: EventAccess): string {
    if (access.summary.role !== 'owner' || !access.member || !access.memberEtag) throw new ApiError(403, 'PURSE_OWNER_REQUIRED');
    return access.memberEtag;
  }

  private async configuration(eventId: string, event: Readonly<Record<string, unknown>>): Promise<PurseConfiguration> {
    if (event.purseConfigured !== undefined && event.purseConfigured !== true) throw new ApiError(503, 'INVALID_STORED_PURSE');
    const row = await optionalRow(this.table, eventId, configurationKey);
    if (!row) {
      if (event.purseConfigured) throw new ApiError(503, 'INVALID_STORED_PURSE');
      const evidence = await this.table.listEntities({ queryOptions: {
        filter: `PartitionKey eq '${eventId}' and RowKey ge 'purse-change:' and RowKey lt 'purse-change;'`,
      } }).byPage({ maxPageSize: 1 }).next();
      if (!evidence.done && (evidence.value.length > 0 || evidence.value.continuationToken)) {
        throw new ApiError(503, 'INVALID_STORED_PURSE');
      }
      return { eventId, etag: null, plan: null, resolutions: [] };
    }
    if (event.purseConfigured !== true || row.kind !== 'purse' || row.schemaVersion !== 1) {
      throw new ApiError(503, 'INVALID_STORED_PURSE');
    }
    const stored = decode(await privateContent(this.table, eventId, configurationKey, row.content), isRecord);
    const value: unknown = { ...stored, etag: revision(row) };
    if (!isPurseConfiguration(value) || value.eventId !== eventId || value.plan === null) {
      throw new ApiError(503, 'INVALID_STORED_PURSE');
    }
    return value;
  }

  private async source(identity: AccountIdentity | PublicScoreIdentity, eventId: string, chargeRead: () => Promise<void>) {
    const access = await this.access(identity, eventId);
    const workspace = await this.workspace.get(identity, eventId);
    if (workspace.etag !== access.summary.etag) throw new ApiError(409, 'EVENT_CHANGED');
    const configuration = await this.configuration(eventId, access.event);
    const roundScores: RoundScores[] = [];
    for (let index = 0; index < workspace.rounds.length; index += 3) {
      roundScores.push(...await Promise.all(workspace.rounds.slice(index, index + 3).map(async (round) => {
        await chargeRead();
        return this.scores.get(identity, eventId, round.id);
      })));
    }
    await assertEventAccessUnchanged(this.table, identity, eventId, access);
    return { ...access, workspace, roundScores, configuration };
  }

  async get(identity: AccountIdentity | PublicScoreIdentity, eventId: string, chargeRead: () => Promise<void>): Promise<EventPurseView> {
    const state = await this.source(identity, eventId, chargeRead);
    const { plan, resolutions } = state.configuration;
    return { workspace: state.workspace, roundScores: state.roundScores, configuration: state.configuration,
      view: plan ? { plan, resolutions, calculation: calculatePurse(plan, state.workspace, state.roundScores, resolutions) } : null };
  }

  private async receipt(eventId: string, requestId: string): Promise<PurseChange | undefined> {
    const row = await optionalRow(this.table, eventId, changeKey(requestId));
    if (!row) return undefined;
    const change = decode(await privateContent(this.table, eventId, changeKey(requestId), row.content), isPurseChange);
    if (row.kind !== 'purse-change' || change.id !== requestId || change.eventId !== eventId) throw new ApiError(503, 'INVALID_STORED_PURSE');
    return change;
  }

  async receive(identity: AccountIdentity, eventId: string, expected: string | null, requestId: string, body: unknown) {
    const access = await this.access(identity, eventId, true);
    if (access.summary.status !== 'active') throw new ApiError(409, 'EVENT_ARCHIVED');
    const upload = isRecord(body) ? body.privateUpload ?? body.privateCommit : undefined;
    if (upload !== undefined) {
      if (!isPrivateUpload(upload)) throw new ApiError(400, 'INVALID_PRIVATE_UPLOAD');
      const row = await optionalRow(this.table, eventId, configurationKey);
      if ((row ? revision(row) : null) !== expected) {
        const receiptRow = await optionalRow(this.table, eventId, changeKey(requestId));
        if (!receiptRow || receiptRow.uploadSha256 !== upload.sha256
          || receiptRow.ownerTenantId !== identity.tenantId || receiptRow.ownerObjectId !== identity.objectId
          || receiptRow.expectedBase !== canonical(expected)) throw new ApiError(409, 'PURSE_CHANGED');
      }
    }
    return receivePrivateWrite(this.table, identity, eventId, configurationKey, expected, requestId, body);
  }

  private assertReplay(change: PurseChange, identity: AccountIdentity, plan: PursePlan,
    resolutions: readonly PurseTieResolution[], expected: string | null): void {
    if (change.expectedEtag !== expected || change.recordedBy.tenantId !== identity.tenantId
      || change.recordedBy.objectId !== identity.objectId || !samePursePlan(change.after.plan, plan)
      || !samePurseTieResolutions(change.after.resolutions, resolutions)) throw new ApiError(409, 'PURSE_REQUEST_CONFLICT');
  }

  async save(identity: AccountIdentity, eventId: string, plan: PursePlan, resolutions: readonly PurseTieResolution[],
    expected: string | null, requestId: string, chargeRead: () => Promise<void>,
    publication?: StagedPublication): Promise<PurseWriteResult> {
    if (!isUuid(requestId) || expected !== null && !isEventRevision(expected)) throw new ApiError(400, 'INVALID_PURSE_SETUP');
    if (Buffer.byteLength(JSON.stringify({ plan, resolutions }), 'utf8') > maximumPrivateWriteBytes) throw new ApiError(413, 'REQUEST_TOO_LARGE');
    const access = await this.access(identity, eventId, true);
    if (access.summary.status !== 'active') throw new ApiError(409, 'EVENT_ARCHIVED');
    const previousReceipt = await this.receipt(eventId, requestId);
    if (previousReceipt) {
      this.assertReplay(previousReceipt, identity, plan, resolutions, expected);
      return { current: await this.get(identity, eventId, chargeRead), change: previousReceipt };
    }
    const state = await this.source(identity, eventId, chargeRead);
    const ownerEtag = this.ownerGrant(state);
    if (state.summary.status !== 'active') throw new ApiError(409, 'EVENT_ARCHIVED');
    if (state.configuration.etag !== expected) throw new ApiError(409, 'PURSE_CHANGED');
    if (!isPursePlanForWorkspace(plan, state.workspace, state.roundScores)
      || !isPurseTieResolutions(resolutions, plan, state.workspace, state.roundScores)) throw new ApiError(400, 'INVALID_PURSE_SETUP');
    const change: PurseChange = {
      id: requestId, eventId, expectedEtag: expected,
      before: { plan: state.configuration.plan, resolutions: state.configuration.resolutions },
      after: { plan, resolutions }, recordedAt: new Date().toISOString(),
      recordedBy: { tenantId: identity.tenantId, objectId: identity.objectId },
    };
    const content = await stagePrivateContent(this.table, eventId, configurationKey, identity,
      canonical({ eventId, plan, resolutions }));
    const auditContent = await stagePrivateContent(this.table, eventId, changeKey(requestId), identity, canonical(change));
    const entity = { partitionKey: eventId, rowKey: configurationKey, kind: 'purse', schemaVersion: 1, content };
    try {
      await this.table.submitTransaction([
        ['update', { partitionKey: eventId, rowKey: 'event', purseConfigured: true }, 'Merge', { etag: state.summary.etag }],
        ['update', { partitionKey: eventId, rowKey: `member:${identity.objectId}`, ...change.recordedBy, role: 'owner' },
          'Merge', { etag: ownerEtag }],
        expected === null ? ['create', entity] : ['update', entity, 'Replace', { etag: expected }],
        ['create', { partitionKey: eventId, rowKey: changeKey(requestId), kind: 'purse-change', content: auditContent,
          ownerTenantId: identity.tenantId, ownerObjectId: identity.objectId, expectedBase: canonical(expected),
          ...(publication ? { uploadSha256: publication.sha256 } : {}) }],
      ]);
    } catch (error) {
      const committed = await this.receipt(eventId, requestId);
      if (committed) {
        this.assertReplay(committed, identity, plan, resolutions, expected);
        return { current: await this.get(identity, eventId, chargeRead), change: committed };
      }
      if (isConflict(error)) throw new ApiError(409, 'PURSE_CHANGED');
      throw error;
    }
    return { current: await this.get(identity, eventId, chargeRead), change };
  }
}
