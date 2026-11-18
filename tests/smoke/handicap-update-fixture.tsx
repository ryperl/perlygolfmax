import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import type { CatalogClient } from '../../src/client/catalog';
import type { PublicServices } from '../../src/client/public-events';
import type { EventServices } from '../../src/app/EventsPage';
import type { IndexObservation, PlayerProfile } from '../../src/domain/catalog';
import type { EventWorkspace } from '../../src/domain/setup';
import { purseTestId } from '../../src/domain/purse.test-support';
import { PublicGroupPage } from '../../src/app/PublicGroupPage';
import { catalogPlayers, catalogVersions } from './catalog-workspace-data';
import '../../src/app/styles.css';

export function Fixture() {
  const [writes, setWrites] = useState({ observations: 0, attempts: 0, sameRetry: true, source: '', date: '' });
  const [services] = useState(() => {
    const first = catalogPlayers[0], version = catalogVersions[0], tee = version?.data.teeProfiles[0];
    if (!first || !version || !tee) throw new Error('Missing fictional HI fixture.');
    const original: IndexObservation = { id: purseTestId(810), value: '4.0', effectiveDate: '2026-01-02',
      source: 'Fictional start', recordedAt: '2026-01-02T00:00:00Z', previousObservationId: null,
      recordedBy: { tenantId: purseTestId(900), objectId: purseTestId(901) } };
    let player: PlayerProfile = { ...first, currentIndex: original }, applied = '4.0', attempts = 0, retryId = '';
    const unavailable = () => Promise.reject(new Error('Unavailable in this fictional fixture.'));
    const event = { id: purseTestId(820), name: 'Fictional Handicap Event', createdAt: '2026-01-01T00:00:00Z',
      role: 'viewer' as const, status: 'active' as const, etag: 'fictional-event-v1' };
    const workspace = (): EventWorkspace => ({
      event, etag: event.etag, location: 'Fictional Club', publicAccess: true, canViewScores: true,
      roster: [{ playerId: player.id, displayName: player.displayName, handicapIndexValue: player.currentIndex?.value ?? null }],
      rounds: ['In progress', 'Completed'].map((name, index) => ({
        id: purseTestId(830 + index), name, courseId: version.courseId, courseVersionId: version.id,
        course: version.data, teeProfile: tee, scoringStarted: true,
        groups: [{ number: 1, playerIds: [player.id] }],
        players: [{ playerId: player.id, displayName: player.displayName,
          handicapIndexValue: index === 0 ? applied : original.value }],
      })),
    });
    const setup = { load: () => Promise.resolve(workspace()), save: unavailable, refreshIndices: unavailable };
    const catalog: CatalogClient = {
      courses: unavailable, version: unavailable, beginImport: unavailable, importStatus: unavailable,
      uploadProfile: unavailable, publish: unavailable, players: unavailable, createPlayer: unavailable,
      renamePlayer: unavailable, history: unavailable,
      player: () => Promise.resolve(player),
      recordIndex: (_old, input, id) => {
        player = { ...player, etag: 'fictional-player-v2', currentIndex: { ...original, ...input, id } };
        setWrites((old) => ({ ...old, observations: old.observations + 1, source: input.source, date: input.effectiveDate }));
        return Promise.resolve(player);
      },
      refreshEventIndex: (_event, _player, _observation, _etag, id) => {
        attempts += 1;
        if (attempts === 1) retryId = id;
        setWrites((old) => ({ ...old, attempts, sameRetry: old.sameRetry && retryId === id }));
        if (attempts === 1) return Promise.reject(new Error('Fictional interrupted round response.'));
        applied = player.currentIndex?.value ?? original.value;
        return Promise.resolve({ eventId: event.id, playerId: player.id, etag: 'fictional-event-v2',
          updatedRoundIds: [purseTestId(830)], completedRoundIds: [purseTestId(831)] });
      },
    };
    const scores = { load: unavailable, save: unavailable, saveGames: unavailable, history: unavailable };
    const organizer: EventServices = { catalog, setup, scores,
      session: { initialize: () => Promise.resolve(true), token: unavailable, signIn: unavailable, signOut: unavailable },
      events: { capabilities: () => Promise.resolve({ canCreateEvents: true, canManageCatalog: true,
        playerHandicapUpdatesSupported: true }), list: unavailable, create: unavailable, setStatus: unavailable } };
    const publicServices: PublicServices = { setup, scores, events: { list: unavailable },
      purse: { load: unavailable, save: unavailable }, leaderboard: { load: unavailable } };
    return { organizer, publicServices, event };
  });
  return <main className="app"><PublicGroupPage organizer={services.organizer} services={services.publicServices}
    eventId={services.event.id} onUnavailable={(message) => { throw new Error(message); }} />
    <output data-testid="hi-fixture-state" data-observations={writes.observations} data-attempts={writes.attempts}
      data-stable-retry={String(writes.sameRetry)} data-source={writes.source} data-date={writes.date} />
  </main>;
}
const host = document.getElementById('hi-fixture');
if (!host) throw new Error('Missing fictional HI fixture host.');
createRoot(host).render(<Fixture />);
