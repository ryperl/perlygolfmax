import { dotsCallResult } from '../../domain/dots';
import type { DotsCall } from '../../domain/dots';
import type { HoleScore } from '../../domain/scoring';

export function CalledSpecialControls({ kind, calls, name, score, par, blocked, onChange, hasOpponents = true, validateCalls }: {
  readonly kind: 'murphy' | 'paree' | 'pully-murphy';
  readonly calls: readonly DotsCall[];
  readonly name: string;
  readonly score: HoleScore | undefined;
  readonly par: number;
  readonly blocked: boolean;
  readonly onChange: (calls: readonly DotsCall[]) => void;
  readonly hasOpponents?: boolean;
  readonly validateCalls?: ((calls: readonly DotsCall[]) => boolean) | undefined;
}) {
  const selected = calls.filter((call) => call.kind === kind);
  const label = kind === 'murphy' ? 'Murphy' : kind === 'paree' ? 'Paree' : 'Pully Murphy';
  function newCall(id: string = crypto.randomUUID()): DotsCall {
    return { id, kind, result: 'pending',
      ...(kind === 'murphy' ? { murphyTarget: 'par', murphyPresses: 0 }
        : kind === 'paree' ? { pareeTarget: 'par' } : { pullyMurphyTarget: 'par' }) };
  }
  function scoreTarget(call: DotsCall): DotsCall {
    return { ...call, result: 'pending', ...(kind === 'murphy' ? { murphyTarget: 'par' }
      : kind === 'paree' ? { pareeTarget: 'par' } : { pullyMurphyTarget: 'par' }) };
  }
  function replace(call: DotsCall, value: DotsCall) {
    onChange(calls.map((entry) => entry.id === call.id ? value : entry));
  }
  const slots = selected.length > 0 ? selected : [undefined];
  return <div className="dots-call-controls">
    {slots.map((call, index) => {
      const suffix = selected.length > 1 ? ` ${String(index + 1)}` : '';
      const result = call ? dotsCallResult(call, score, par) : 'pending';
      const stage = call?.murphyPresses ?? 0;
      const automatic = kind === 'murphy' ? call?.murphyTarget !== undefined : kind === 'paree'
        ? call?.pareeTarget !== undefined : call?.pullyMurphyTarget !== undefined;
      const target = par - (kind === 'murphy' && call?.murphyTarget === 'birdie' ? 1 : 0);
      const candidate = call ? undefined : newCall('new-call-candidate');
      const nextCalls = candidate ? [...calls, candidate] : calls;
      const targetChange = call ? calls.map((entry) => entry.id === call.id ? { ...call, result: 'pending' as const,
        murphyTarget: call.murphyTarget === 'birdie' ? 'par' as const : 'birdie' as const } : entry) : calls;
      return <div className={`dots-call ${kind}-call${call ? '' : ' is-uncalled'}`} key={index === 0 ? 'primary' : call?.id}>
        <label className="dots-special-choice">
          <input type="checkbox" checked={call !== undefined} disabled={!call && (blocked || validateCalls?.(nextCalls) === false)}
            aria-label={`${label} called${suffix} · ${name}`}
            onChange={() => { onChange(call ? calls.filter((entry) => entry.id !== call.id)
              : [...calls, newCall()]); }} />
          <span>{label} called{suffix}</span>
        </label>
        {call && <>
        {kind === 'murphy' && <label className="dots-special-choice">
          <input type="checkbox" checked={call.murphyTarget === 'birdie'}
            disabled={par !== 4 && par !== 5 && call.murphyTarget !== 'birdie' || validateCalls?.(targetChange) === false}
            aria-label={`Murphy for birdie${suffix} · ${name}`}
            onChange={(event) => { replace(call, { ...call, result: 'pending',
              murphyTarget: event.target.checked ? 'birdie' : 'par' }); }} />
          <span>For birdie</span>
        </label>}
        <p className="called-special-outcome" aria-live="polite">{automatic
          ? result === 'pending' ? 'Pending · enter a gross score'
            : `${result === 'success' ? 'Made' : hasOpponents ? 'Missed · opponents earn' : 'Missed · no opponents'} · needs ${kind === 'pully-murphy' ? `exact gross par ${String(target)}` : `${String(target)} or better`}`
          : `Manual result: ${result === 'success' ? 'Made' : result === 'failure' ? 'Missed' : 'Pending'}`}</p>
        {!automatic && <button type="button" disabled={validateCalls?.(calls.map((entry) => entry.id === call.id ? scoreTarget(call) : entry)) === false} onClick={() => {
          replace(call, scoreTarget(call));
        }}>Use score outcome{suffix}</button>}
        {kind === 'murphy' && <div className="dots-count-control"><span>Murphy stakes{suffix}</span>
          <div className="dots-count-stepper">
            <button type="button" aria-label={`Decrease Murphy stakes${suffix} · ${name}`} disabled={stage === 0}
              onClick={() => { replace(call, { ...call, murphyPresses: stage === 2 ? 1 : 0 }); }}>−</button>
            <output aria-label={`Murphy stakes${suffix} · ${name}`}>×{stage + 1}</output>
            <button type="button" aria-label={`Increase Murphy stakes${suffix} · ${name}`} disabled={stage === 2}
              onClick={() => { replace(call, { ...call, murphyPresses: stage === 0 ? 1 : 2 }); }}>+</button>
          </div>
        </div>}
        </>}
      </div>;
    })}
    {kind === 'pully-murphy' && <small>Call the long par putt explicitly. Only the gross score determines its made/missed outcome.</small>}
    {kind === 'paree' && selected.length > 0 && <button type="button" aria-label={`Add another Paree call · ${name}`}
      disabled={validateCalls?.([...calls, newCall('new-call-candidate')]) === false}
      onClick={() => { onChange([...calls, newCall()]); }}>Add another Paree call</button>}
    {blocked && selected.length === 0 && <small>Clear this golfer&apos;s Hogan before calling Murphy.</small>}
  </div>;
}
