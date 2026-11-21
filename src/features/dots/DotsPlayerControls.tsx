import { dotsCallResult, dotsDeclarationWriteIssues, dotsCoexistenceWriteIssues, dotsManualKindsFor, dotsSpecialCatalog } from '../../domain/dots';
import type { DotsCall, DotsContest, DotsGameDefinition, DotsPlayerDeclaration, DotsSpecialKind } from '../../domain/dots';
import type { HoleScore } from '../../domain/scoring';
import { CalledSpecialControls } from './CalledSpecialControls';
import { coexistenceMessage } from './coexistence-message';

export function DotsPlayerControls({ game, declaration, saved, name, par, onChange, specialLabels, allowMurphyPresses = false,
  scoreDerivedMurphy = false, scoreDerivedParee = false, scoreDerivedPullyMurphy = false, score, contests = [], coexistenceRules = false, categoryPar }: {
  readonly game: DotsGameDefinition;
  readonly declaration: DotsPlayerDeclaration;
  readonly saved: DotsPlayerDeclaration | undefined;
  readonly name: string;
  readonly par: number;
  readonly onChange: (value: DotsPlayerDeclaration) => void;
  readonly specialLabels?: Readonly<Partial<Record<DotsSpecialKind, string>>> | undefined;
  readonly allowMurphyPresses?: boolean;
  readonly scoreDerivedMurphy?: boolean;
  readonly scoreDerivedParee?: boolean;
  readonly scoreDerivedPullyMurphy?: boolean;
  readonly score?: HoleScore | undefined;
  readonly contests?: readonly DotsContest[];
  readonly coexistenceRules?: boolean;
  readonly categoryPar?: number | undefined;
}) {
  const enabled = (kind: DotsSpecialKind) => game.specials.some((special) => special.kind === kind);
  const hasOpponents = game.mode !== 'individual' || game.playerIds.length > 1;
  const context = scoreDerivedMurphy || scoreDerivedParee || scoreDerivedPullyMurphy ? { score, par } : undefined;
  const validate = (value: DotsPlayerDeclaration) => coexistenceRules
    ? dotsCoexistenceWriteIssues(value, { score, par, contests, categoryPar }) : dotsDeclarationWriteIssues(value, context);
  const issues = validate(declaration);
  const failedCallConflict = issues.conflicts.some((issue) => issue.code === 'FAILED_CALL_SPECIAL');
  const hasFailedCall = declaration.calls.some((call) => dotsCallResult(call, score, par) === 'failure'
    && (call.murphyTarget !== 'birdie' || score?.kind !== 'strokes' || score.strokes > par));
  const label = (kind: DotsSpecialKind) => specialLabels?.[kind] ?? dotsSpecialCatalog.find((special) => special.kind === kind)?.label ?? kind;
  const active = (kind: DotsSpecialKind) => (declaration.counts[kind] ?? 0) > 0
    || declaration.calls.some((call) => call.kind === kind);
  function blocked(kind: DotsSpecialKind): boolean {
    if (active(kind)) return false;
    const candidate: DotsPlayerDeclaration = { ...declaration, counts: { ...declaration.counts, [kind]: 1 } };
    return validate(candidate).conflicts.some((issue) => issue.code !== 'DIME_SUPER_DIME' && issue.kinds.includes(kind));
  }
  function changeCount(kind: DotsSpecialKind, count: number) {
    const counts = { ...declaration.counts, [kind]: count };
    // Only replace unsaved alternatives. Acknowledged declarations need explicit review.
    if (count > 0 && kind === 'super-dime' && (declaration.counts.dime ?? 0) > 0 && !(saved?.counts.dime)) counts.dime = 0;
    if (count > 0 && kind === 'dime' && (declaration.counts['super-dime'] ?? 0) > 0 && !(saved?.counts['super-dime'])) counts['super-dime'] = 0;
    onChange({ ...declaration, counts });
  }
  const manual = dotsSpecialCatalog.filter((special) => enabled(special.kind) && dotsManualKindsFor(game).includes(special.kind)
    && (special.kind !== 'gorilla' || par === 5 || active(special.kind)));
  const calls: readonly DotsCall['kind'][] = ['paree', 'murphy', 'pully-murphy'];
  const single = manual.filter((special) => special.kind !== 'sandy' && special.kind !== 'other');
  function countState(kind: DotsSpecialKind) {
    const count = declaration.counts[kind] ?? 0;
    const replacement: DotsSpecialKind | null = kind === 'dime' ? 'super-dime' : kind === 'super-dime' ? 'dime' : null;
    const savedAlternative = replacement !== null && (saved?.counts[replacement] ?? 0) > 0 && active(replacement) && count <= 0;
    const positive = { ...declaration, counts: { ...declaration.counts, [kind]: 1 } };
    const additions = validate(positive).conflicts.filter((issue) => issue.kinds.includes(kind));
    const additionBlocked = additions.some((issue) => issue.code !== 'DIME_SUPER_DIME');
    return { count, invalid: !Number.isSafeInteger(count) || count < 0,
      replacement, savedAlternative, additionBlocked, locked: blocked(kind) || savedAlternative,
      reason: additions.find((issue) => issue.code !== 'DIME_SUPER_DIME') };
  }
  function countInput(kind: DotsSpecialKind) {
    const state = countState(kind);
    return <input aria-label={`${label(kind)} count · ${name}`} type="number" inputMode="numeric"
      min="0" step="1" disabled={state.locked && !state.invalid} aria-invalid={state.invalid} value={state.count} onChange={(event) => {
        changeCount(kind, event.target.value === '' ? 0 : Number(event.target.value));
      }} />;
  }
  return <div className="dots-player-controls">
    {single.length > 0 && <div className="dots-quick-choices">{single.map((special) => {
      const { count, locked, reason } = countState(special.kind);
      return <label className="dots-special-choice" key={special.kind}>
        <input type="checkbox" checked={count > 0} disabled={locked} aria-label={`${label(special.kind)} for ${name}`}
          title={locked && reason ? coexistenceMessage(reason, label) : undefined}
          onChange={(event) => { changeCount(special.kind, event.target.checked ? 1 : 0); }} />
        <span>{special.kind === 'super-dime' ? <>Super<wbr />Dime</> : label(special.kind)}{count > 1 && <small> ×{count}</small>}</span>
      </label>;
    })}</div>}
    {manual.filter((special) => special.kind === 'sandy' || special.kind === 'other').map((special) => {
      const { count, invalid, locked, additionBlocked, reason } = countState(special.kind);
      return <div className="dots-count-control" key={special.kind}><span>{label(special.kind)}</span>
          <div className="dots-count-stepper">
            <button type="button" aria-label={`Decrease ${label(special.kind)} for ${name}`} disabled={locked || invalid || count <= 0}
              onClick={() => { changeCount(special.kind, count - 1); }}>−</button>
            {countInput(special.kind)}
            <button type="button" aria-label={`Increase ${label(special.kind)} for ${name}`} disabled={locked || invalid || additionBlocked || count >= Number.MAX_SAFE_INTEGER}
              title={reason ? coexistenceMessage(reason, label) : undefined}
              onClick={() => { changeCount(special.kind, count + 1); }}>+</button>
          </div>{coexistenceRules && reason && <small>{coexistenceMessage(reason, label)}</small>}</div>;
    })}
    {scoreDerivedMurphy && enabled('murphy') && <CalledSpecialControls kind="murphy" calls={declaration.calls} name={name}
      score={score} par={par} blocked={(declaration.counts.hogan ?? 0) > 0} hasOpponents={hasOpponents}
      validateCalls={coexistenceRules ? (calls) => validate({ ...declaration, calls }).conflicts.length === 0 : undefined}
      onChange={(value) => { onChange({ ...declaration, calls: value }); }} />}
    {scoreDerivedParee && enabled('paree') && <CalledSpecialControls kind="paree" calls={declaration.calls} name={name}
      score={score} par={par} blocked={false} hasOpponents={hasOpponents}
      validateCalls={coexistenceRules ? (calls) => validate({ ...declaration, calls }).conflicts.length === 0 : undefined}
      onChange={(value) => { onChange({ ...declaration, calls: value }); }} />}
    {scoreDerivedPullyMurphy && enabled('pully-murphy') && <CalledSpecialControls kind="pully-murphy" calls={declaration.calls} name={name}
      score={score} par={par} blocked={false} hasOpponents={hasOpponents}
      validateCalls={coexistenceRules ? (calls) => validate({ ...declaration, calls }).conflicts.length === 0 : undefined}
      onChange={(value) => { onChange({ ...declaration, calls: value }); }} />}
    {calls.filter((kind) => enabled(kind) && !(scoreDerivedMurphy && kind === 'murphy')
      && !(scoreDerivedParee && kind === 'paree') && !(scoreDerivedPullyMurphy && kind === 'pully-murphy')).map((kind) => {
      const callBlocked = kind === 'murphy' && (declaration.counts.hogan ?? 0) > 0;
      return <div className="dots-call-controls" key={kind}>
        <button type="button" aria-label={`Call ${label(kind)} · ${name}`} disabled={callBlocked} onClick={() => {
          onChange({ ...declaration, calls: [...declaration.calls, { id: crypto.randomUUID(), kind, result: 'pending',
            ...(allowMurphyPresses && kind === 'murphy' ? { murphyPresses: 0 as const } : {}) }] });
        }}>Call {label(kind)}</button>
        {callBlocked && <small>Clear this golfer&apos;s Hogan before calling Murphy.</small>}
        {declaration.calls.filter((call) => call.kind === kind).map((call, index) => {
          const outcomeBlocked = (result: DotsCall['result']) => validate({ ...declaration,
            calls: declaration.calls.map((entry) => entry.id === call.id ? { ...entry, result } : entry),
          }).conflicts.some((issue) => issue.kinds.includes(kind));
          const failureBlocked = call.result !== 'failure' && outcomeBlocked('failure');
          const successBlocked = call.result !== 'success' && outcomeBlocked('success');
          return <div className="dots-call" key={call.id}>
          <label>{label(kind)} call {index + 1}
            <select aria-label={`${label(kind)} call ${String(index + 1)} · ${name}`} value={call.result} onChange={(event) => {
              const result = event.target.value;
              if (result === 'pending' || result === 'success' || result === 'failure') onChange({ ...declaration,
                calls: declaration.calls.map((entry) => entry.id === call.id ? { ...entry, result } : entry) });
            }}><option value="pending">Called · Outcome pending</option><option value="success" disabled={successBlocked}>Success</option>
              <option value="failure" disabled={failureBlocked}>{hasOpponents ? 'Failed · Opponents earn' : 'Failed · No opponents'}</option></select></label>
          {failureBlocked && <small>Clear this golfer&apos;s par-or-better specials or made calls before marking this call failed.</small>}
          {successBlocked && <small>Correct this golfer&apos;s failed call before recording another made call.</small>}
          {allowMurphyPresses && kind === 'murphy' && <label>Murphy press stage
            <select aria-label={`Murphy press stage ${String(index + 1)} · ${name}`} value={call.murphyPresses ?? 0}
              onChange={(event) => {
                const stage = Number(event.target.value);
                if (stage === 0 || stage === 1 || stage === 2) onChange({ ...declaration,
                  calls: declaration.calls.map((entry) => entry.id === call.id ? { ...entry, murphyPresses: stage } : entry) });
              }}><option value="0">Initial call · ×1</option><option value="1">Opposing press · ×2</option>
              <option value="2">Calling side presses back · ×3</option></select>
          </label>}
          <button type="button" aria-label={`Remove ${label(kind)} call ${String(index + 1)} · ${name}`} onClick={() => {
            onChange({ ...declaration, calls: declaration.calls.filter((entry) => entry.id !== call.id) });
          }}>Remove call</button>
        </div>; })}
      </div>;
    })}
    {single.length > 0 && <details className="dots-count-details"><summary>Details / edit counts</summary>
      {single.map((special) => {
        const { replacement, savedAlternative } = countState(special.kind);
        return <label key={special.kind}>{label(special.kind)}
          <small>{special.kind === 'sweep' && game.sweepRule === 'manual-v1'
            ? 'Scorer-declared Sweep; shared with current teammates. Automatic High/Low and category sweeps are separate.'
            : special.description}</small>
          {replacement && active(replacement) && !savedAlternative && <small>Selecting {label(special.kind)} replaces unsaved {label(replacement)}.</small>}
          {savedAlternative && replacement && <small>Saved {label(replacement)} is retained. Clear it explicitly before choosing {label(special.kind)}.</small>}
          {countInput(special.kind)}
        </label>;
      })}
    </details>}
    {manual.filter((special) => countState(special.kind).invalid).map((special) =>
      <span className="dots-entry-error" role="alert" key={special.kind}>{label(special.kind)} count must be a whole number of 0 or more.</span>)}
    {hasFailedCall && !failedCallConflict && <p role="note">A failed call excludes this golfer&apos;s par-or-better specials and {label('dime')}. Correct or remove the failed call to enable them.</p>}
    {failedCallConflict && <p role="alert">This golfer has a failed call and a conflicting par-or-better special, made call or {label('dime')}. Clear or correct the conflicting declaration; saved values have not been removed.</p>}
    {issues.conflicts.filter((issue) => issue.code !== 'FAILED_CALL_SPECIAL').map((issue) => <p role="alert" key={`${issue.code}:${issue.kinds.join(':')}`}>
      {coexistenceMessage(issue, label)} Review {name}&apos;s declarations; saved values have not been removed.
    </p>)}
    {coexistenceRules && manual.some((special) => countState(special.kind).locked) && <p className="dots-entry-hint">
      Unavailable choices conflict with this golfer&apos;s score or other selections. Clear the conflicting choice or correct the score.
    </p>}
    {issues.warnings.map((issue) => <p key={issue.code} role="note">{issue.kinds.map(label).join(' + ')} for {name}: check your entry. This combination is allowed.</p>)}
    {manual.length === 0 && !calls.some(enabled) && <small>No individual entries enabled; automatic specials use saved scores.</small>}
  </div>;
}
