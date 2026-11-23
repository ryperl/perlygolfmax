import type { DotsGameDefinition, DotsSpecialSelection } from '../../domain/dots';
import { dotsSpecialCatalog } from '../../domain/dots';

export function DotsGameDescription({ specials, mode, manualSweep = false, highLowVersion }: {
  readonly specials: readonly DotsSpecialSelection[];
  readonly mode: DotsGameDefinition['mode'];
  readonly manualSweep?: boolean;
  readonly highLowVersion?: 1 | 2 | undefined;
}) {
  const enabled = new Set(specials.map((special) => special.kind));
  const selected = dotsSpecialCatalog.filter((special) => enabled.has(special.kind));
  const automatic = (special: typeof dotsSpecialCatalog[number]) =>
    special.automatic && !(special.kind === 'sweep' && manualSweep);
  const entered = selected.filter((special) => !automatic(special));
  const calculated = selected.filter(automatic);
  return <details>
    <summary>How Dots works</summary>
    <section aria-label="Dots game description">
      <p>Save gross strokes and the facts of each hole. The app applies the selected dot values;
        do not add calculated bonuses again as Other or Manual Sweep.</p>
      <h4>What you enter</h4>
      <p>Declare shot-based specials, calls and category winners. A score alone cannot tell the app
        whether you hit the fairway, recovered from a bunker or made a long putt.
        Calls must be declared; score-based call outcomes use saved gross scores.</p>
      {entered.length > 0 ? <ul>{entered.map((special) => <li key={special.kind}>
        <strong>{special.kind === 'sweep' ? 'Manual Sweep' : special.label}: </strong>
        {special.kind === 'sweep'
          ? 'A separate agreed bonus, entered once for the earning golfer. Never use it to duplicate Category Sweep or High/Low Sweep.'
          : special.description}
      </li>)}</ul> : <p>No entered specials selected.</p>}
      <h4>What the app calculates</h4>
      <p>Automatic awards use saved scores and declared winners, not unsaved drafts.
        Special score qualifications stay personal gross: SO changes net comparisons, not Birdie or String.
        Only selected specials earn their configured values.</p>
      {calculated.length > 0 && <ul>{calculated.map((special) => <li key={special.kind}>
        <strong>{special.kind === 'sweep' ? 'Legacy linked High/Low Sweep' : special.label}: </strong>
        {special.description}
      </li>)}</ul>}
      {enabled.has('long-drive') && enabled.has('blue-plate') && <p>
        <strong>Automatic Category Sweep: </strong>The same golfer wins Long Drive and Blue Plate
        on the same par-5 hole: one extra dot for that golfer and each current teammate.
        Different winners do not qualify. Carried dots and second qualifiers do not increase this bonus.
      </p>}
      {highLowVersion !== undefined && <p>
        <strong>Net High/Low: </strong>Compare each pair&apos;s higher ball for High and lower ball for Low.
        Each contest earns one dot per winning teammate; ties push with no carry.
        {highLowVersion === 2
          ? ' Automatic High/Low Sweep adds one more dot per teammate only when the same pair wins both. Together, a double win earns three dots per teammate.'
          : ' This saved High/Low version has no automatic High/Low Sweep.'}
      </p>}
      {calculated.length === 0 && highLowVersion === undefined
        && !(enabled.has('long-drive') && enabled.has('blue-plate'))
        && <p>No automatic awards selected.</p>}
      <h4>Sharing and settlement</h4>
      <p>{mode === 'individual'
        ? 'Individual awards go to the earning golfer. Solo play has no opponents or money settlement.'
        : 'Enter each earned special once, under the golfer who earned it. The app credits each current teammate in full; do not enter it again for the partner.'}
        {' '}Walk, selected Pickup and failed calls award opponents, not the earning side.
        King of the Hill is an individual round bonus, never shared.
        Settlement compares total earned dots at the saved rate; it is not a payment.</p>
      <p>Saved legacy games retain their original rules. This description does not change a game.</p>
    </section>
  </details>;
}
