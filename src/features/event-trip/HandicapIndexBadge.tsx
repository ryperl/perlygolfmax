export function HandicapIndexBadge({ value, context }: {
  readonly value: string | null | undefined;
  readonly context: 'current' | 'captured';
}) {
  const label = value === null ? 'No Handicap Index'
    : value === undefined ? 'Handicap Index unavailable' : `${context === 'current' ? 'Current' : 'Captured'} Handicap Index: ${value}`;
  return <span className="event-trip-index" aria-label={label} title={label}>
    {value === null ? 'NH' : value === undefined ? 'HI —' : `HI ${value}`}
  </span>;
}
