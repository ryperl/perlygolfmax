import './player-names.css';

/**
 * A golfer's name that narrows to initials in compact views on small screens. The initials are drawn by CSS
 * from a data attribute, so the page text, copy/paste and the accessible name all stay the full name.
 */
export function PlayerName({ name, initials }: { readonly name: string; readonly initials: string | undefined }) {
  if (!initials) return <>{name}</>;
  return <span className="player-name" data-initials={initials}>
    <span className="player-name-full">{name}</span>
  </span>;
}
