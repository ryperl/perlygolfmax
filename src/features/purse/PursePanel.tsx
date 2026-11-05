import { useEffect, useRef, useState } from 'react';
import { EventChangedError } from '../../client/events';
import { isPursePlanForWorkspace, isPurseTieResolutions } from '../../contracts/purse';
import type { EventPurseView, PurseSelection, PurseWriteResult } from '../../domain/purse-settings';
import { calculatePurse, samePursePlan, samePurseTieResolutions, validatePursePlanContext } from '../../domain/purse';
import type { PursePlan, PurseTieResolution } from '../../domain/purse';
import type { PurseDraft } from './purse-draft';
import { buildPurseDraft, draftFromPlan, reviewSelection } from './purse-draft';
import { PurseResults } from './PurseResults';
import { PurseSettings } from './PurseSettings';
import './purse.css';

export interface PursePanelProps {
  readonly value: EventPurseView;
  readonly busy: boolean;
  readonly onSave: (plan: PursePlan, resolutions: readonly PurseTieResolution[], etag: string | null, requestId: string) => Promise<PurseWriteResult | null>;
  readonly onRefresh: () => Promise<EventPurseView | null>;
  readonly onDirtyChange?: (dirty: boolean) => void;
}

interface Attempt {
  readonly plan: PursePlan;
  readonly resolutions: readonly PurseTieResolution[];
  readonly etag: string | null;
  readonly id: string;
}
interface Editor {
  readonly draft: PurseDraft;
  readonly resolutions: readonly PurseTieResolution[];
  readonly base: PurseSelection;
  readonly etag: string | null;
  readonly context: EventPurseView;
  readonly attempt: Attempt | null;
  readonly conflict: boolean;
  readonly latest: EventPurseView | null;
  readonly observed: PurseSelection & { readonly etag: string | null };
}

function sameSelection(left: PurseSelection, right: PurseSelection): boolean {
  return samePursePlan(left.plan, right.plan) && samePurseTieResolutions(left.resolutions, right.resolutions);
}

/** Keying isolates an event's private draft when the app changes the selected event. */
export function PursePanel(props: PursePanelProps) {
  return <EventPursePanel key={props.value.workspace.event.id} {...props} />;
}

function EventPursePanel({ value, busy, onSave, onRefresh, onDirtyChange }: PursePanelProps) {
  const [editor, setEditor] = useState<Editor | null>(null);
  const [message, setMessage] = useState('');
  const [working, setWorking] = useState(false);
  const [confirmed, setConfirmed] = useState<{ readonly value: EventPurseView; readonly previousEtag: string | null } | null>(null);
  const inFlight = useRef(false);
  const dirtyCallback = useRef(onDirtyChange);
  const current = confirmed && value.configuration.etag === confirmed.previousEtag ? confirmed.value : value;
  const archived = value.workspace.event.status === 'archived' || editor?.latest?.workspace.event.status === 'archived';
  const disabled = busy || working || archived;
  const changedExternally = editor !== null && value.configuration.etag !== editor.observed.etag
    && !sameSelection(value.configuration, editor.observed)
    && !sameSelection(value.configuration, editor.base);
  const conflict = editor?.conflict === true || changedExternally;
  const plan = editor ? buildPurseDraft(editor.draft, value.workspace.event.id) : null;
  const contextIssues = plan && editor ? validatePursePlanContext(plan, editor.context.workspace, editor.context.roundScores) : [];
  const decisionsValid = plan !== null && editor !== null
    && isPurseTieResolutions(editor.resolutions, plan, editor.context.workspace, editor.context.roundScores);
  const valid = plan !== null && contextIssues.length === 0 && decisionsValid;

  useEffect(() => { dirtyCallback.current = onDirtyChange; }, [onDirtyChange]);
  useEffect(() => () => { dirtyCallback.current?.(false); }, []);

  function open() {
    if (disabled || editor) return;
    setEditor({ draft: draftFromPlan(current.configuration.plan), resolutions: current.configuration.resolutions,
      base: current.configuration, etag: current.configuration.etag, context: current,
      attempt: null, conflict: false, latest: null, observed: value.configuration });
    onDirtyChange?.(true);
    setMessage('');
  }
  function change(draft: PurseDraft) {
    if (disabled || editor?.attempt) return;
    setEditor((previous) => previous ? { ...previous, draft } : previous);
    setMessage('');
  }
  function resolutions(next: readonly PurseTieResolution[]) {
    if (disabled || editor?.attempt) return;
    setEditor((previous) => previous ? { ...previous, resolutions: next } : previous);
    setMessage('');
  }
  async function save() {
    if (!editor || !plan || !valid || disabled || conflict || inFlight.current) return;
    const attempt = editor.attempt ?? { plan, resolutions: editor.resolutions, etag: editor.etag, id: crypto.randomUUID() };
    const pending = { ...editor, attempt };
    setEditor(pending);
    setMessage('');
    inFlight.current = true;
    setWorking(true);
    try {
      const result = await onSave(attempt.plan, attempt.resolutions, attempt.etag, attempt.id);
      if (!result || result.change.id !== attempt.id || result.change.eventId !== value.workspace.event.id
        || result.change.expectedEtag !== attempt.etag || !sameSelection(result.change.before, editor.base)
        || !sameSelection(result.change.after, attempt)) {
        setMessage('Save is not confirmed. Your draft is retained and locked for an exact retry. Retry or refresh and review; no new request is inferred.');
        return;
      }
      if (result.current.workspace.event.id !== value.workspace.event.id
        || result.current.configuration.eventId !== value.workspace.event.id
        || !sameSelection(result.current.configuration, attempt)) {
        setEditor({ ...pending, conflict: true, latest: null });
        setMessage('Your save was acknowledged, but the latest configuration differs. Your draft is retained. Refresh and explicitly review before saving again.');
        return;
      }
      setConfirmed({ value: result.current, previousEtag: value.configuration.etag });
      setEditor(null);
      onDirtyChange?.(false);
      setMessage('Purse settings saved. Awards remain calculations, not payments.');
    } catch (error) {
      if (error instanceof EventChangedError) {
        setEditor({ ...pending, conflict: true, latest: null });
        setMessage('Purse settings changed. Your draft is retained. Refresh and review the complete plan before saving.');
      } else {
        setMessage(`${error instanceof Error ? error.message : 'Save failed.'} Save is not confirmed. Your draft is retained and locked for an exact retry. Retry or refresh and review.`);
      }
    } finally {
      inFlight.current = false;
      setWorking(false);
    }
  }
  async function refresh() {
    if (!editor || busy || working || inFlight.current) return;
    inFlight.current = true;
    setWorking(true);
    setEditor({ ...editor, conflict: true, latest: null });
    try {
      const latest = await onRefresh();
      if (!latest || latest.workspace.event.id !== value.workspace.event.id || latest.configuration.eventId !== value.workspace.event.id) {
        setMessage('Refresh is not confirmed for this event. Your draft is retained; try again.');
      } else {
        setEditor({ ...editor, conflict: true, latest });
        setMessage('Latest purse loaded for review. An earlier unconfirmed save may already have applied. Review before creating a new save.');
      }
    } catch (error) {
      setMessage(`${error instanceof Error ? error.message : 'Refresh failed.'} Your draft is retained; try again.`);
    } finally {
      inFlight.current = false;
      setWorking(false);
    }
  }
  function review() {
    if (!editor?.latest || !plan || disabled) return;
    const merged = reviewSelection(editor.base, { plan, resolutions: editor.resolutions }, editor.latest.configuration);
    setEditor({ draft: draftFromPlan(merged.plan), resolutions: merged.resolutions,
      base: editor.latest.configuration, etag: editor.latest.configuration.etag, context: editor.latest,
      attempt: null, conflict: false, latest: null, observed: value.configuration });
    setMessage('Reviewed draft now preserves untouched latest pools. Your explicitly edited or removed pools replace those latest versions. Check the preview and save when ready.');
  }
  return <section className="purse-panel" aria-label="Event purse">
    <header><p className="purse-hint">{value.workspace.event.name}</p><h2>Event purse</h2>
      <p>Plan awards and calculate each golfer’s winnings. No money is collected or transferred here. No Ryder Cup sides or closest-to-pin scoring engine.</p>
    </header>
    {archived && <p>This event is archived. Purse settings are read-only.</p>}
    {!current.configuration.plan && <p>No purse configured. There is no assumed budget or winnings total.</p>}
    {current.view && <PurseResults value={current} plan={current.view.plan} calculation={current.view.calculation} />}
    {current.configuration.plan && !current.view && <p>Purse results are unavailable. Refresh saved sources; no winners or zero totals are assumed.</p>}
    {!editor && !archived && <button type="button" disabled={disabled} onClick={open}>
      {current.configuration.plan ? 'Edit purse' : 'Configure purse'}
    </button>}
    {message && <p role="status" className="purse-notice">{message}</p>}
    {editor && <>
      {conflict && <div className="purse-notice" role="status">
        <p>Review required. Your complete draft is retained; saving is paused so other pools are not silently overwritten.</p>
        {editor.latest && <div>
          <h3>Latest saved configuration</h3>
          <p>{editor.latest.configuration.plan?.currency ?? 'No currency'} · {editor.latest.configuration.plan?.pools.length ?? 0} pools</p>
          <ul>{editor.latest.configuration.plan?.pools.map((pool) => <li key={pool.id}>{pool.name}</li>)}</ul>
          <p>Review keeps your changed funding and edited/deleted pools, and preserves untouched latest pools. It also keeps explicit tie-decision edits.
            Compare the latest result below with your draft preview before accepting.</p>
          {editor.latest.view && <PurseResults value={editor.latest} plan={editor.latest.view.plan} calculation={editor.latest.view.calculation} />}
        </div>}
        <button type="button" disabled={disabled || !editor.latest || !plan} onClick={review}>Review my draft against latest purse</button>
      </div>}
      <PurseSettings value={editor.context} draft={editor.draft} plan={plan} resolutions={editor.resolutions}
        disabled={disabled || editor.attempt !== null} onChange={change} onResolutions={resolutions} />
      {!plan && <p role="alert">Check currency, funding, pool names, unique positive whole-number places, and money amounts with at most two decimal places. Amounts must fit exact minor-unit arithmetic.</p>}
      {contextIssues.length > 0 && <p role="alert">Some saved sources or recipients are unavailable or invalid. Choose current saved sources and roster recipients before saving.</p>}
      {plan && !decisionsValid && <p role="alert">A tie decision is stale or invalid. Remove or re-resolve it before saving.</p>}
      <p className="purse-hint">Draft preview uses the saved source snapshot loaded for editing. Refresh and review if scores, roster, or game settings change.</p>
      {plan && <PurseResults value={editor.context} plan={plan}
        calculation={calculatePurse(plan, editor.context.workspace, editor.context.roundScores, editor.resolutions)} draft />}
      <div className="purse-actions">
        <button type="button" disabled={disabled || conflict || !valid} onClick={() => { void save(); }}>
          {editor.attempt ? 'Retry purse save' : 'Save purse'}
        </button>
        <button type="button" disabled={busy || working} onClick={() => { void refresh(); }}>Refresh latest purse</button>
        <button type="button" disabled={busy || working} onClick={() => {
          setEditor(null); onDirtyChange?.(false);
          setMessage(editor.attempt ? 'Draft closed. Closing does not undo an earlier save. Refresh to see saved settings.' : 'Unsaved purse draft discarded.');
        }}>Cancel purse editing</button>
      </div>
      {editor.latest?.workspace.event.status === 'archived' && <p>The refreshed event is archived. Your draft is retained read-only.</p>}
      {plan && !isPursePlanForWorkspace(plan, editor.context.workspace, editor.context.roundScores) && <p className="purse-hint">
        The full plan, including off-screen pools and recipients, must be valid before saving.
      </p>}
    </>}
  </section>;
}
