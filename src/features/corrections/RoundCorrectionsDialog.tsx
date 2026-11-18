import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { RoundCorrectionsClient } from '../../client/round-corrections';
import type { RoundCorrectionReadModel, RoundCorrectionWriteRequest } from '../../domain/round-corrections';
import { isHandicapIndex } from '../../contracts/catalog';
import { SessionExpiredError } from '../../client/events';
import { PrivateRequestError } from '../../client/private-request';
import './corrections.css';

type Correction = RoundCorrectionWriteRequest['correction'];
function initial(model: RoundCorrectionReadModel): Correction {
  return { teeProfileId: model.teeProfileId, playerTeeSelections: model.playerTeeSelections,
    groups: model.groups, gameTeams: model.gameTeams,
    players: model.players.map((player) => ({ playerId: player.playerId, handicapIndexValue: player.handicapIndex?.value ?? null })) };
}
interface Props {
  readonly client: RoundCorrectionsClient;
  readonly eventId: string;
  readonly roundId: string;
  readonly roundName: string;
  readonly onClose: () => void;
  readonly onSessionExpired: (message: string) => void;
}
export function RoundCorrectionsDialog(props: Props) {
  const [scope, setScope] = useState({ client: props.client, generation: 0 });
  if (scope.client !== props.client) setScope({ client: props.client, generation: scope.generation + 1 });
  return <RoundCorrectionsController key={`${props.eventId}:${props.roundId}:${String(scope.generation)}`} {...props} />;
}
function RoundCorrectionsController({ client, eventId, roundId, roundName, onClose, onSessionExpired }: Props) {
  const [model, setModel] = useState<RoundCorrectionReadModel>();
  const [draft, setDraft] = useState<Correction>();
  const [reason, setReason] = useState('');
  const [reviewed, setReviewed] = useState(false);
  const [selected, setSelected] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const pending = useRef<{ readonly body: string; readonly id: string } | undefined>(undefined);
  const request = useRef<AbortController | null>(null);
  const live = useRef(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const expiry = useRef(onSessionExpired);
  const id = useId();
  const dirty = model !== undefined && draft !== undefined
    && (JSON.stringify(draft) !== JSON.stringify(initial(model)) || reason !== '' || reviewed);
  useLayoutEffect(() => { dialog.current?.showModal(); heading.current?.focus(); }, []);
  useEffect(() => { expiry.current = onSessionExpired; }, [onSessionExpired]);
  useEffect(() => {
    live.current = true;
    const controller = new AbortController();
    request.current = controller;
    void client.load(eventId, roundId, controller.signal).then((value) => {
      if (controller.signal.aborted) return;
      if (value.eventId !== eventId || value.roundId !== roundId) throw new Error('Correction tools did not match this round.');
      setModel(value); setDraft(initial(value)); setReason(''); setReviewed(false); pending.current = undefined;
    }).catch((failure: unknown) => {
      if (controller.signal.aborted) return;
      const message = failure instanceof Error ? failure.message : 'Correction tools could not be loaded.';
      if (failure instanceof SessionExpiredError || failure instanceof PrivateRequestError && [401, 403, 404].includes(failure.status)) {
        setModel(undefined); setDraft(undefined); setReason(''); setReviewed(false); pending.current = undefined;
      }
      setError(message);
      if (failure instanceof SessionExpiredError) expiry.current(message);
    }).finally(() => { if (!controller.signal.aborted) { request.current = null; setBusy(false); } });
    return () => { live.current = false; controller.abort(); request.current?.abort(); };
  }, [client, eventId, roundId, attempt]);
  useEffect(() => {
    if (!dirty && !busy) return;
    function beforeUnload(event: BeforeUnloadEvent) { event.preventDefault(); }
    window.addEventListener('beforeunload', beforeUnload);
    return () => { window.removeEventListener('beforeunload', beforeUnload); };
  }, [dirty, busy]);
  const playerId = model?.players.some((player) => player.playerId === selected) ? selected : model?.players[0]?.playerId;
  const player = draft?.players.find((entry) => entry.playerId === playerId);
  const group = draft?.groups.find((entry) => entry.playerIds.includes(playerId ?? ''));
  const valid = draft?.players.every((entry) => entry.handicapIndexValue === null || isHandicapIndex(entry.handicapIndexValue)) === true;
  function close() { if (!busy && !dirty) { dialog.current?.close(); onClose(); } }
  async function save() {
    if (busy || request.current || !model || !draft || !reviewed || !reason.trim() || !valid) return;
    const body: RoundCorrectionWriteRequest = {
      expected: { eventEtag: model.eventEtag, roundEtag: model.roundEtag,
        ...(model.gamesEtag === undefined ? {} : { gamesEtag: model.gamesEtag }),
        ...(model.inputRevision === undefined ? {} : { inputRevision: model.inputRevision }) },
      correction: { ...draft, groups: draft.groups.filter((entry) => entry.playerIds.length > 0) },
      reason: reason.trim(), reviewSummary: 'Organizer reviewed captured inputs and dependent game, skins and purse recalculation.',
    };
    const serialized = JSON.stringify(body);
    if (pending.current?.body !== serialized) pending.current = { body: serialized, id: crypto.randomUUID() };
    const controller = new AbortController();
    request.current = controller;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await client.save(eventId, roundId, body, pending.current.id, controller.signal);
      if (!live.current || controller.signal.aborted) return;
      if (result.model.eventId !== eventId || result.model.roundId !== roundId) throw new Error('Correction acknowledgement did not match this round. Refresh before continuing.');
      setModel(result.model); setDraft(initial(result.model)); setReason(''); setReviewed(false); pending.current = undefined;
      setNotice(result.applied ? 'Correction saved. Fresh result reads recalculate games, skins and purse awards. Review flagged decisions.'
        : 'No new correction applied. Current saved inputs are shown.');
    } catch (failure) {
      if (!live.current || controller.signal.aborted) return;
      const message = failure instanceof Error ? failure.message : 'Correction was not confirmed.';
      const denied = failure instanceof SessionExpiredError
        || failure instanceof PrivateRequestError && [401, 403, 404].includes(failure.status);
      if (denied) {
        setModel(undefined); setDraft(undefined); setReason(''); setReviewed(false); pending.current = undefined;
      }
      setError(denied ? message : `${message} Draft retained. Retry unchanged with the same operation, or discard and reload to review saved inputs.`);
      if (failure instanceof SessionExpiredError) expiry.current(message);
    } finally { if (live.current && !controller.signal.aborted) { request.current = null; setBusy(false); } }
  }
  return <dialog ref={dialog} className="round-corrections-dialog" aria-labelledby={`${id}-heading`}
    onCancel={(event) => { event.preventDefault(); close(); }}>
    <h2 id={`${id}-heading`} ref={heading} tabIndex={-1}>{roundName} · Correct saved inputs</h2>
    <p>Event-local organizer correction. Golfers and captured course/version stay fixed. Raw scores, original captures and catalog profiles are not rewritten.</p>
    {busy && <p role="status">Contacting correction service…</p>}
    {error && <p role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {model && draft && <form onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <fieldset disabled={busy}>
        <legend>Captured round inputs</legend>
        <label>Round default tee<select value={draft.teeProfileId} onChange={(event) => {
          setDraft({ ...draft, teeProfileId: Number(event.target.value) }); setReviewed(false);
        }}>{model.compatibleTees.map((tee) => <option key={tee.id} value={tee.id}>{tee.name} · {tee.category}</option>)}</select></label>
        <label>Golfer<select value={playerId} onChange={(event) => { setSelected(event.target.value); }}>
          {model.players.map((entry) => <option key={entry.playerId} value={entry.playerId}>{entry.displayName}</option>)}
        </select></label>
        {player && <>
          <label>Captured Handicap Index<input value={player.handicapIndexValue ?? ''} disabled={player.handicapIndexValue === null}
            autoComplete="off" onChange={(event) => {
              setDraft({ ...draft, players: draft.players.map((entry) => entry.playerId === player.playerId
                ? { ...entry, handicapIndexValue: event.target.value } : entry) }); setReviewed(false);
            }} /></label>
          <label className="correction-check"><input type="checkbox" checked={player.handicapIndexValue === null} onChange={(event) => {
            setDraft({ ...draft, players: draft.players.map((entry) => entry.playerId === player.playerId
              ? { ...entry, handicapIndexValue: event.target.checked ? null : '' } : entry) }); setReviewed(false);
          }} />No Handicap Index (NH)</label>
          {model.allowPerGolferTees && <label>Golfer tee<select value={draft.playerTeeSelections?.find((entry) => entry.playerId === player.playerId)?.teeProfileId ?? ''}
            onChange={(event) => {
              setDraft({ ...draft, playerTeeSelections: [
                ...(draft.playerTeeSelections ?? []).filter((entry) => entry.playerId !== player.playerId),
                ...(event.target.value === '' ? [] : [{ playerId: player.playerId, teeProfileId: Number(event.target.value) }]),
              ] }); setReviewed(false);
            }}><option value="">Round default</option>{model.compatibleTees.map((tee) => <option key={tee.id} value={tee.id}>{tee.name} · {tee.category}</option>)}</select></label>}
          <label>Playing group<select value={group?.number ?? ''} onChange={(event) => {
            setDraft({ ...draft, groups: draft.groups.map((entry) => ({ ...entry,
              playerIds: [...entry.playerIds.filter((current) => current !== player.playerId),
                ...(String(entry.number) === event.target.value ? [player.playerId] : [])],
            })) }); setReviewed(false);
          }}><option value="">Unassigned</option>{draft.groups.map((entry) => <option key={entry.number} value={entry.number}>Group {entry.number}</option>)}</select></label>
        </>}
        <button type="button" onClick={() => {
          const number = draft.groups.reduce((highest, entry) => Math.max(highest, entry.number), 0) + 1;
          setDraft({ ...draft, groups: [...draft.groups, { number, playerIds: [] }] }); setReviewed(false);
        }}>Add playing group</button>
        <details><summary>Group starting holes</summary>{draft.groups.map((entry) => <label key={entry.number}>Group {entry.number} starting hole
          <select value={entry.startingHole ?? ''} onChange={(event) => {
            const { startingHole, ...group } = entry; void startingHole;
            setDraft({ ...draft, groups: draft.groups.map((current) => current.number === entry.number
              ? { ...group, ...(event.target.value ? { startingHole: Number(event.target.value) } : {}) } : current) }); setReviewed(false);
          }}><option value="">Captured default</option>{model.compatibleTees.find((tee) => tee.id === draft.teeProfileId)?.holes.map((hole) =>
            <option key={hole.number} value={hole.number}>{hole.number}</option>)}</select>
        </label>)}</details>
        {(draft.gameTeams ?? []).map((game, gameIndex) => <details key={game.gameId}><summary>Competition game {gameIndex + 1} teams</summary>
          <p>Keep full teams and assign each golfer once. Scored Churchie order remains protected.</p>
          {game.teams.map((team) => <fieldset key={team.id}><legend>{team.name}</legend>
            {model.players.map((entry) => <label className="correction-check" key={entry.playerId}><input type="checkbox"
              checked={team.playerIds.includes(entry.playerId)} onChange={(event) => {
                setDraft({ ...draft, gameTeams: (draft.gameTeams ?? []).map((current) => current.gameId !== game.gameId ? current : {
                  ...current, teams: current.teams.map((candidate) => candidate.id !== team.id ? candidate : { ...candidate,
                    playerIds: event.target.checked ? [...candidate.playerIds, entry.playerId] : candidate.playerIds.filter((current) => current !== entry.playerId),
                  }),
                }) }); setReviewed(false);
              }} />{entry.displayName}</label>)}
          </fieldset>)}
        </details>)}
        <label>Correction reason<textarea required value={reason} onChange={(event) => { setReason(event.target.value); setReviewed(false); }} /></label>
        <label className="correction-check"><input type="checkbox" checked={reviewed} onChange={(event) => { setReviewed(event.target.checked); }} />
          I reviewed the captured inputs and understand games, skins and purse awards will recalculate; stale decisions may need review.
        </label>
        {!valid && <p role="alert">Enter a valid Handicap Index or explicitly select NH.</p>}
        <button type="submit" disabled={!dirty || !reviewed || !reason.trim() || !valid}>Save audited correction</button>
      </fieldset>
      {model.warnings.length > 0 && <aside aria-label="Correction review warnings"><h3>Organizer review</h3>
        <ul>{model.warnings.map((warning) => <li key={`${warning.code}:${warning.message}`}>{warning.message}</li>)}</ul></aside>}
    </form>}
    <div className="event-actions">
      <button type="button" disabled={busy} onClick={() => {
        setBusy(true); setError(''); setNotice(''); setAttempt((previous) => previous + 1);
      }}>{dirty ? 'Discard draft and reload' : 'Refresh correction tools'}</button>
      <button type="button" disabled={busy || dirty} onClick={close}>Back to scores</button>
    </div>
  </dialog>;
}
