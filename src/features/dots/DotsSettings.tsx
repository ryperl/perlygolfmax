import { dotsSpecialCatalog } from '../../domain/dots';
import type { DotsGameDefinition, DotsSpecialKind, DotsSpecialSelection } from '../../domain/dots';
import type { RoundGroup } from '../../domain/setup';
import type { WolfGameDefinition } from '../../domain/wolf';
import { formatMoney } from '../../domain/money';

export interface DotsSetupDraft {
  readonly groupNumber?: number;
  readonly dotsMode?: DotsGameDefinition['mode'];
  readonly dotsPlayers?: readonly string[];
  readonly dotsPlayerIds?: readonly string[];
  readonly dotsSpecials?: readonly DotsSpecialSelection[];
  readonly linkedGameId?: string;
  readonly stake?: string;
}

export function DotsSettings({ draft, groups, players, wolves, onChange }: {
  readonly draft: DotsSetupDraft;
  readonly groups: readonly RoundGroup[];
  readonly players: readonly { readonly playerId: string; readonly displayName: string }[];
  readonly wolves: readonly WolfGameDefinition[];
  readonly onChange: (patch: DotsSetupDraft) => void;
}) {
  const group = groups.find((entry) => entry.number === draft.groupNumber);
  const linked = wolves.find((game) => game.id === draft.linkedGameId);
  const specials = draft.dotsSpecials ?? [];
  const mode = draft.dotsMode ?? 'individual';
  const compatible = (kind: DotsSpecialKind, selectedMode: DotsGameDefinition['mode']) =>
    (kind !== 'sweep' || selectedMode === 'linked') && (kind !== 'assassin' || selectedMode !== 'individual');
  return <section aria-label="Dots setup">
    <p>Separate earned specials within one foursome. Configure before the round&apos;s first saved score.</p>
    <label>Dots playing group<select value={draft.groupNumber ?? ''} onChange={(event) => {
      const selected = groups.find((entry) => entry.number === Number(event.target.value));
      if (selected) onChange({ groupNumber: selected.number, dotsPlayers: selected.playerIds, dotsPlayerIds: selected.playerIds, linkedGameId: '' });
    }}><option value="">Choose saved foursome</option>{groups.filter((entry) => entry.playerIds.length === 4).map((entry) =>
      <option key={entry.number} value={entry.number}>Group {entry.number}</option>)}</select></label>
    <label>Dots mode<select value={draft.dotsMode ?? 'individual'} onChange={(event) => {
      const selectedMode = event.target.value;
      if ((selectedMode === 'individual' || selectedMode === 'fixed' || selectedMode === 'linked') && selectedMode !== mode) {
        onChange({ dotsMode: selectedMode, dotsSpecials: specials.filter((special) => compatible(special.kind, selectedMode)) });
      }
    }}><option value="individual">Individual</option><option value="fixed">Fixed partners</option>
      <option value="linked">Link to earned Wolf</option></select></label>
    <small>Changing modes removes incompatible specials. Other edits retain your saved selections.</small>
    {draft.dotsMode === 'linked' ? <>
      <label>Linked game<select value={draft.linkedGameId ?? ''} onChange={(event) => { onChange({ linkedGameId: event.target.value }); }}>
        <option value="">Choose compatible Wolf game</option>{wolves.filter((game) => game.version === 2 && game.groupNumber === draft.groupNumber).map((game) =>
          <option key={game.id} value={game.id}>{game.name}</option>)}</select></label>
      <p>Uses the saved Wolf sides and multiplier. Shared rate: {linked?.stakeMinor == null ? 'No money configured' : `${formatMoney(linked.stakeMinor, 'USD')} per dot difference`}.
        One combined settlement, not a second rate.</p>
    </> : <>
      {draft.dotsMode === 'fixed' && (draft.dotsPlayers ?? []).map((id, index) => <label key={index}>
        Side {index < 2 ? 'A' : 'B'} golfer {index % 2 + 1}<select value={id} onChange={(event) => {
          const ids = [...(draft.dotsPlayers ?? [])], other = ids.indexOf(event.target.value);
          if (other >= 0) { ids[other] = id; ids[index] = event.target.value; onChange({ dotsPlayers: ids }); }
        }}>{group?.playerIds.map((playerId) => <option key={playerId} value={playerId}>
          {players.find((player) => player.playerId === playerId)?.displayName ?? 'Golfer unavailable'}</option>)}</select></label>)}
      <label>USD per dot difference<span>$ <input aria-label="USD per dot difference" inputMode="decimal" value={draft.stake ?? ''}
        onChange={(event) => { onChange({ stake: event.target.value }); }} /></span></label>
      <small>Optional dollars and cents, for example 0.50. Blank or 0 means points-only. Each golfer settles individually against the other three.</small>
    </>}
    <fieldset><legend>Enabled specials and whole-dot units</legend>{dotsSpecialCatalog.map((special) => {
      const selected = specials.find((entry) => entry.kind === special.kind);
      const incompatible = !compatible(special.kind, mode);
      return <div key={special.kind}>
        <label><span>{special.label}{special.automatic ? ' · Automatic' : ''}</span><input type="checkbox" checked={selected !== undefined}
          disabled={incompatible}
          onChange={(event) => { onChange({ dotsSpecials: event.target.checked
            ? [...specials, { kind: special.kind, units: special.defaultUnits }] : specials.filter((entry) => entry.kind !== special.kind) }); }} /></label>
        <small>{special.description}</small>
        {incompatible && <small>{special.kind === 'sweep' ? 'Sweep requires a linked game with actual High and Low results.'
          : 'Assassin requires partnered 2-v-2 play, not individual mode.'}
          {selected && ' This saved selection is retained for review; change mode before saving.'}</small>}
        {selected && <label>{special.label} units<input type="number" min="1" step="1" value={selected.units}
          disabled={incompatible}
          onChange={(event) => { onChange({ dotsSpecials: specials.map((entry) => entry.kind === special.kind
            ? { ...entry, units: event.target.value === '' ? 0 : Number(event.target.value) } : entry) }); }} /></label>}
      </div>;
    })}</fieldset>
  </section>;
}
