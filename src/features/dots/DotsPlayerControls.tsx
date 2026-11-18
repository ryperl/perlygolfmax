import { dotsDeclarationIssues, dotsManualKinds, dotsSpecialCatalog } from '../../domain/dots';
import type { DotsCall, DotsGameDefinition, DotsPlayerDeclaration, DotsSpecialKind } from '../../domain/dots';

export function DotsPlayerControls({ game, declaration, saved, name, par, onChange, specialLabels, allowMurphyPresses = false }: {
  readonly game: DotsGameDefinition;
  readonly declaration: DotsPlayerDeclaration;
  readonly saved: DotsPlayerDeclaration | undefined;
  readonly name: string;
  readonly par: number;
  readonly onChange: (value: DotsPlayerDeclaration) => void;
  readonly specialLabels?: Readonly<Partial<Record<DotsSpecialKind, string>>> | undefined;
  readonly allowMurphyPresses?: boolean;
}) {
  const enabled = (kind: DotsSpecialKind) => game.specials.some((special) => special.kind === kind);
  const issues = dotsDeclarationIssues(declaration);
  const label = (kind: DotsSpecialKind) => specialLabels?.[kind] ?? dotsSpecialCatalog.find((special) => special.kind === kind)?.label ?? kind;
  const active = (kind: DotsSpecialKind) => (declaration.counts[kind] ?? 0) > 0
    || declaration.calls.some((call) => call.kind === kind);
  function blocked(kind: DotsSpecialKind): boolean {
    if (active(kind)) return false;
    const candidate: DotsPlayerDeclaration = { ...declaration, counts: { ...declaration.counts, [kind]: 1 } };
    return dotsDeclarationIssues(candidate).conflicts.some((issue) => issue.code !== 'DIME_SUPER_DIME' && issue.kinds.includes(kind));
  }
  function changeCount(kind: DotsSpecialKind, count: number) {
    const counts = { ...declaration.counts, [kind]: count };
    // Only replace unsaved alternatives. Acknowledged declarations need explicit review.
    if (count > 0 && kind === 'super-dime' && (declaration.counts.dime ?? 0) > 0 && !(saved?.counts.dime)) counts.dime = 0;
    if (count > 0 && kind === 'dime' && (declaration.counts['super-dime'] ?? 0) > 0 && !(saved?.counts['super-dime'])) counts['super-dime'] = 0;
    onChange({ ...declaration, counts });
  }
  const manual = dotsSpecialCatalog.filter((special) => enabled(special.kind) && dotsManualKinds.includes(special.kind)
    && (special.kind !== 'gorilla' || par === 5 || active(special.kind)));
  const calls: readonly DotsCall['kind'][] = ['paree', 'murphy', 'pully-murphy'];
  const single = manual.filter((special) => special.kind !== 'sandy' && special.kind !== 'other');
  function countState(kind: DotsSpecialKind) {
    const count = declaration.counts[kind] ?? 0;
    const replacement: DotsSpecialKind | null = kind === 'dime' ? 'super-dime' : kind === 'super-dime' ? 'dime' : null;
    const savedAlternative = replacement !== null && (saved?.counts[replacement] ?? 0) > 0 && active(replacement) && count <= 0;
    return { count, invalid: !Number.isSafeInteger(count) || count < 0,
      replacement, savedAlternative, locked: blocked(kind) || savedAlternative };
  }
  function countInput(kind: DotsSpecialKind) {
    const state = countState(kind);
    return <input aria-label={`${label(kind)} count · ${name}`} type="number" inputMode="numeric"
      min="0" step="1" disabled={state.locked} aria-invalid={state.invalid} value={state.count} onChange={(event) => {
        changeCount(kind, event.target.value === '' ? 0 : Number(event.target.value));
      }} />;
  }
  return <div className="dots-player-controls">
    {single.length > 0 && <div className="dots-quick-choices">{single.map((special) => {
      const { count, locked } = countState(special.kind);
      return <label className="dots-special-choice" key={special.kind}>
        <input type="checkbox" checked={count > 0} disabled={locked} aria-label={`${label(special.kind)} for ${name}`}
          onChange={(event) => { changeCount(special.kind, event.target.checked ? 1 : 0); }} />
        <span>{special.kind === 'super-dime' ? <>Super<wbr />Dime</> : label(special.kind)}{count > 1 && <small> ×{count}</small>}</span>
      </label>;
    })}</div>}
    {manual.filter((special) => special.kind === 'sandy' || special.kind === 'other').map((special) => {
      const { count, invalid, locked } = countState(special.kind);
      return <div className="dots-count-control" key={special.kind}><span>{label(special.kind)}</span>
          <div className="dots-count-stepper">
            <button type="button" aria-label={`Decrease ${label(special.kind)} for ${name}`} disabled={locked || invalid || count <= 0}
              onClick={() => { changeCount(special.kind, count - 1); }}>−</button>
            {countInput(special.kind)}
            <button type="button" aria-label={`Increase ${label(special.kind)} for ${name}`} disabled={locked || invalid || count >= Number.MAX_SAFE_INTEGER}
              onClick={() => { changeCount(special.kind, count + 1); }}>+</button>
          </div></div>;
    })}
    {calls.filter(enabled).map((kind) => {
      const callBlocked = kind === 'murphy' && (declaration.counts.hogan ?? 0) > 0;
      return <div className="dots-call-controls" key={kind}>
        <button type="button" aria-label={`Call ${label(kind)} · ${name}`} disabled={callBlocked} onClick={() => {
          onChange({ ...declaration, calls: [...declaration.calls, { id: crypto.randomUUID(), kind, result: 'pending',
            ...(allowMurphyPresses && kind === 'murphy' ? { murphyPresses: 0 as const } : {}) }] });
        }}>Call {label(kind)}</button>
        {callBlocked && <small>Clear this golfer&apos;s Hogan before calling Murphy.</small>}
        {declaration.calls.filter((call) => call.kind === kind).map((call, index) => <div className="dots-call" key={call.id}>
          <label>{label(kind)} call {index + 1}
            <select aria-label={`${label(kind)} call ${String(index + 1)} · ${name}`} value={call.result} onChange={(event) => {
              const result = event.target.value;
              if (result === 'pending' || result === 'success' || result === 'failure') onChange({ ...declaration,
                calls: declaration.calls.map((entry) => entry.id === call.id ? { ...entry, result } : entry) });
            }}><option value="pending">Called · Outcome pending</option><option value="success">Success</option>
              <option value="failure">Failed · Opponents earn</option></select></label>
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
        </div>)}
      </div>;
    })}
    {single.length > 0 && <details className="dots-count-details"><summary>Details / edit counts</summary>
      {single.map((special) => {
        const { replacement, savedAlternative } = countState(special.kind);
        return <label key={special.kind}>{label(special.kind)}
          <small>{special.description}</small>
          {replacement && active(replacement) && !savedAlternative && <small>Selecting {label(special.kind)} replaces unsaved {label(replacement)}.</small>}
          {savedAlternative && replacement && <small>Saved {label(replacement)} is retained. Clear it explicitly before choosing {label(special.kind)}.</small>}
          {countInput(special.kind)}
        </label>;
      })}
    </details>}
    {manual.filter((special) => countState(special.kind).invalid).map((special) =>
      <span className="dots-entry-error" role="alert" key={special.kind}>{label(special.kind)} count must be a whole number of 0 or more.</span>)}
    {issues.conflicts.map((issue) => <p role="alert" key={issue.code}>
      {issue.kinds.map(label).join(' + ')} conflict for {name}. Review saved declarations; new changes cannot save this combination.
    </p>)}
    {issues.warnings.map((issue) => <p key={issue.code} role="note">{issue.kinds.map(label).join(' + ')} for {name}: check your entry. This combination is allowed.</p>)}
    {manual.length === 0 && !calls.some(enabled) && <small>No individual entries enabled; automatic specials use saved scores.</small>}
  </div>;
}
