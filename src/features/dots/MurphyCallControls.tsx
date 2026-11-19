import { dotsCallResult } from '../../domain/dots';
import type { DotsCall } from '../../domain/dots';
import type { HoleScore } from '../../domain/scoring';

export function MurphyCallControls({ calls, name, score, par, blocked, onChange }: {
  readonly calls: readonly DotsCall[];
  readonly name: string;
  readonly score: HoleScore | undefined;
  readonly par: number;
  readonly blocked: boolean;
  readonly onChange: (calls: readonly DotsCall[]) => void;
}) {
  const murphys = calls.filter((call) => call.kind === 'murphy');
  function replace(call: DotsCall, value: DotsCall) {
    onChange(calls.map((entry) => entry.id === call.id ? value : entry));
  }
  const slots = murphys.length > 0 ? murphys : [undefined];
  return <div className="dots-call-controls murphy-call-controls">
    {slots.map((call, index) => {
      const suffix = murphys.length > 1 ? ` ${String(index + 1)}` : '';
      const result = call ? dotsCallResult(call, score, par) : 'pending';
      const stage = call?.murphyPresses ?? 0;
      const automatic = call?.murphyTarget !== undefined;
      const target = par - (call?.murphyTarget === 'birdie' ? 1 : 0);
      return <div className="dots-call murphy-call" key={index === 0 ? 'primary' : call?.id}>
        <label className="dots-special-choice">
          <input type="checkbox" checked={call !== undefined} disabled={!call && blocked}
            aria-label={`Murphy called${suffix} · ${name}`}
            onChange={() => { onChange(call ? calls.filter((entry) => entry.id !== call.id)
              : [...calls, { id: crypto.randomUUID(), kind: 'murphy',
                result: 'pending', murphyTarget: 'par', murphyPresses: 0 }]); }} />
          <span>Murphy called{suffix}</span>
        </label>
        {call && <>
        <label className="dots-special-choice">
          <input type="checkbox" checked={call.murphyTarget === 'birdie'}
            disabled={par !== 4 && par !== 5 && call.murphyTarget !== 'birdie'}
            aria-label={`Murphy for birdie${suffix} · ${name}`}
            onChange={(event) => { replace(call, { ...call, result: 'pending',
              murphyTarget: event.target.checked ? 'birdie' : 'par' }); }} />
          <span>For birdie</span>
        </label>
        <p className="murphy-outcome" aria-live="polite">{automatic
          ? result === 'pending' ? 'Pending · enter a gross score'
            : `${result === 'success' ? 'Made' : 'Missed · opponents earn'} · needs ${String(target)} or better`
          : `Manual result: ${result === 'success' ? 'Made' : result === 'failure' ? 'Missed' : 'Pending'}`}</p>
        {!automatic && <button type="button" onClick={() => {
          replace(call, { ...call, result: 'pending', murphyTarget: 'par' });
        }}>Use score outcome{suffix}</button>}
        <div className="dots-count-control"><span>Murphy stakes{suffix}</span>
          <div className="dots-count-stepper">
            <button type="button" aria-label={`Decrease Murphy stakes${suffix} · ${name}`} disabled={stage === 0}
              onClick={() => { replace(call, { ...call, murphyPresses: stage === 2 ? 1 : 0 }); }}>−</button>
            <output aria-label={`Murphy stakes${suffix} · ${name}`}>×{stage + 1}</output>
            <button type="button" aria-label={`Increase Murphy stakes${suffix} · ${name}`} disabled={stage === 2}
              onClick={() => { replace(call, { ...call, murphyPresses: stage === 0 ? 1 : 2 }); }}>+</button>
          </div>
        </div>
        </>}
      </div>;
    })}
    {blocked && murphys.length === 0 && <small>Clear this golfer&apos;s Hogan before calling Murphy.</small>}
  </div>;
}
