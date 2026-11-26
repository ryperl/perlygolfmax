import type { DotsGameDefinition, DotsSpecialSelection } from '../../domain/dots';
import { dotsSpecialCatalog } from '../../domain/dots';

type CatalogSpecial = typeof dotsSpecialCatalog[number];

const manualSweepDescription = 'A separate agreed bonus, entered once for the earning golfer. '
  + 'Never use it to duplicate Category Sweep or High/Low Sweep.';

function isCalculated(special: CatalogSpecial, manualSweep: boolean): boolean {
  if (special.kind === 'sweep' && manualSweep) return false;
  return special.automatic;
}

function enteredLabel(special: CatalogSpecial): string {
  if (special.kind === 'sweep') return 'Manual Sweep';
  return special.label;
}

function enteredDescription(special: CatalogSpecial): string {
  if (special.kind === 'sweep') return manualSweepDescription;
  return special.description;
}

// An automatic Sweep in the catalog is only the legacy linked High/Low rule;
// rotating Dots describes its own versioned High/Low Sweep separately.
function calculatedLabel(special: CatalogSpecial): string {
  if (special.kind === 'sweep') return 'Legacy linked High/Low Sweep';
  return special.label;
}

function highLowSweepText(highLowVersion: 1 | 2): string {
  if (highLowVersion === 2) {
    return ' Automatic High/Low Sweep adds one more dot per teammate only when the same pair wins both.'
      + ' Together, a double win earns three dots per teammate.';
  }
  return ' This saved High/Low version has no automatic High/Low Sweep.';
}

function categorySweepRecipients(playsAlone: boolean): string {
  if (playsAlone) return 'one extra dot for that golfer.';
  return 'one extra dot for that golfer and each current teammate.';
}

function sharingText(mode: DotsGameDefinition['mode'], linkedToNines: boolean): string {
  if (linkedToNines) {
    return 'Each golfer plays alone, so awards go to the earning golfer. '
      + 'Walk, selected Pickup and failed calls award both opponents. '
      + 'Settlement combines Nines points and dots once at the Nines stake; it is not a payment.';
  }
  if (mode === 'individual') {
    return 'Individual awards go to the earning golfer. Solo play has no opponents or money settlement. '
      + 'Walk, selected Pickup and failed calls award opponents. '
      + 'Settlement compares total earned dots at the saved rate; it is not a payment.';
  }
  return 'Enter each earned special once, under the golfer who earned it. '
    + 'The app credits each current teammate in full; do not enter it again for the partner. '
    + 'Walk, selected Pickup and failed calls award opponents, not the earning side. '
    + 'Settlement compares total earned dots at the saved rate; it is not a payment.';
}

/**
 * Collapsed player help for one Dots game. It follows the selected specials and separates what scorers
 * enter from what the app calculates, so automatic bonuses are not entered twice. It changes nothing.
 */
export function DotsGameDescription({ specials, mode, manualSweep = false, highLowVersion, linkedToNines = false }: {
  readonly specials: readonly DotsSpecialSelection[];
  readonly mode: DotsGameDefinition['mode'];
  readonly manualSweep?: boolean;
  readonly highLowVersion?: 1 | 2 | undefined;
  /** Nines golfers each play alone, so there are no teammates to share awards with. */
  readonly linkedToNines?: boolean;
}) {
  const enabled = new Set(specials.map((special) => special.kind));
  const selected = dotsSpecialCatalog.filter((special) => enabled.has(special.kind));
  const entered = selected.filter((special) => !isCalculated(special, manualSweep));
  const calculated = selected.filter((special) => isCalculated(special, manualSweep));
  const categorySweep = enabled.has('long-drive') && enabled.has('blue-plate');
  const playsAlone = mode === 'individual' || linkedToNines;
  const noAutomaticAwards = calculated.length === 0 && highLowVersion === undefined && !categorySweep;

  return <details>
    <summary>How Dots works</summary>
    <section aria-label="Dots game description">
      <p>Save gross strokes and the facts of each hole. The app applies the selected dot values;
        do not add calculated bonuses again as Other or Manual Sweep.</p>
      <h4>What you enter</h4>
      <p>Declare shot-based specials, calls and category winners. A score alone cannot tell the app
        whether you hit the fairway, recovered from a bunker or made a long putt.
        Calls must be declared; score-based call outcomes use saved gross scores.</p>
      {entered.length > 0 && <ul>{entered.map((special) => <li key={special.kind}>
        <strong>{enteredLabel(special)}: </strong>{enteredDescription(special)}
      </li>)}</ul>}
      {entered.length === 0 && <p>No entered specials selected.</p>}
      <h4>What the app calculates</h4>
      <p>Automatic awards use saved scores and declared winners, not unsaved drafts.
        Special score qualifications stay personal gross: SO changes net comparisons, not Birdie or String.
        Only selected specials earn their configured values.</p>
      {calculated.length > 0 && <ul>{calculated.map((special) => <li key={special.kind}>
        <strong>{calculatedLabel(special)}: </strong>{special.description}
      </li>)}</ul>}
      {categorySweep && <p>
        <strong>Automatic Category Sweep: </strong>The same golfer wins Long Drive and Blue Plate
        on the same par-5 hole: {categorySweepRecipients(playsAlone)}
        {' '}Different winners do not qualify. Carried dots and second qualifiers do not increase this bonus.
      </p>}
      {highLowVersion !== undefined && <p>
        <strong>Net High/Low: </strong>Compare each pair&apos;s higher ball for High and lower ball for Low.
        Each contest earns one dot per winning teammate; ties push with no carry.
        {highLowSweepText(highLowVersion)}
      </p>}
      {noAutomaticAwards && <p>No automatic awards selected.</p>}
      <h4>Sharing and settlement</h4>
      <p>{sharingText(mode, linkedToNines)} King of the Hill is an individual round bonus, never shared.</p>
      <p>Saved legacy games retain their original rules. This description does not change a game.</p>
    </section>
  </details>;
}
