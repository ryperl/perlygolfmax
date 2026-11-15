import { useEffect, useRef, useState } from 'react';
import type { EventLeaderboardClient } from '../../client/event-leaderboard';
import type { EventSkinsConfiguration } from '../../domain/event-skins';
import { isEventSkinsChange } from '../../contracts/event-skins';
import { sameJsonValue } from '../../contracts/round-context';
import type { EventWorkspace } from '../../domain/setup';

export function EventSkinsSettings({ workspace, configure, onSaved }: {
  readonly workspace: EventWorkspace;
  readonly configure: NonNullable<EventLeaderboardClient['configureEventSkins']>;
  readonly onSaved: () => void;
}) {
  const [enabled, setEnabled] = useState(workspace.eventSkins !== undefined);
  const [pending, setPending] = useState<{
    readonly configuration: EventSkinsConfiguration | null; readonly etag: string; readonly id: string;
  }>();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => { controller.current?.abort(); }, []);
  async function save() {
    const request = pending ?? { configuration: enabled ? { version: 1 as const } : null,
      etag: workspace.etag, id: crypto.randomUUID() };
    setPending(request); setBusy(true); setNotice('');
    controller.current = new AbortController();
    const signal = controller.current.signal;
    try {
      const change = await configure(workspace.event.id, request.configuration, request.etag, request.id, signal);
      if (signal.aborted) return;
      if (!isEventSkinsChange(change) || change.id !== request.id || change.eventId !== workspace.event.id
        || change.expectedEtag !== request.etag || !sameJsonValue(change.after, request.configuration)) {
        throw new Error('Unrelated save acknowledgement.');
      }
      setPending(undefined); setNotice('Event skins settings saved. Loading fresh results.'); onSaved();
    } catch (error) {
      if (signal.aborted) return;
      setNotice(`Save is not confirmed. Keep the same request for retry, or refresh to review. ${error instanceof Error ? error.message : 'Try again when connected.'}`);
    } finally { if (!signal.aborted) setBusy(false); }
  }
  if (workspace.event.role !== 'owner' || workspace.event.status !== 'active'
    || workspace.eventSkinsSupported !== true || workspace.testerAccess) return <p>Event skins settings are read-only.</p>;
  return <fieldset className="event-skins-settings" disabled={busy}>
    <legend>Organizer event skins setup</legend>
    <label><input type="checkbox" checked={enabled} disabled={pending !== undefined}
      onChange={(event) => { setEnabled(event.target.checked); }} /> Enable event-wide net skins</label>
    <p>Separate from the primary overall competition and round games. Disabling retains saved scores and any pot
      for organizer repair. No carryovers. No pot amount is assumed or moved from existing awards.</p>
    <button disabled={!pending && enabled === (workspace.eventSkins !== undefined)}
      onClick={() => { void save(); }}>{pending ? 'Retry event skins save' : 'Save event skins settings'}</button>
    <p role="status">{busy ? 'Saving event skins settings…' : notice}</p>
    <a href={`#organizer?event=${encodeURIComponent(workspace.event.id)}&view=purse`}>Configure the separate event skins purse amount</a>
  </fieldset>;
}
