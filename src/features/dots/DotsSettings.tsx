import { useId, useState } from 'react';
import { dotsSpecialCatalog } from '../../domain/dots';
import type { DotsGameDefinition, DotsSpecialKind, DotsSpecialSelection } from '../../domain/dots';
import type { RoundGroup } from '../../domain/setup';
import type { WolfGameDefinition } from '../../domain/wolf';
import { formatMoney } from '../../domain/money';
import './dots-settings.css';

export interface DotsSetupDraft {
  readonly groupNumber?: number;
  readonly dotsMode?: DotsGameDefinition['mode'];
  readonly dotsVersion?: 1 | 2;
  readonly dotsRotationHoles?: 3 | 6;
  readonly dotsPlayers?: readonly string[];
  readonly dotsPlayerIds?: readonly string[];
  readonly dotsSpecials?: readonly DotsSpecialSelection[];
  readonly linkedGameId?: string;
  readonly stake?: string;
}

export function DotsSettings({ draft, groups, players, wolves, onChange, v2Supported = false, individualPlayerCounts = [4] }: {
  readonly draft: DotsSetupDraft;
  readonly groups: readonly RoundGroup[];
  readonly players: readonly { readonly playerId: string; readonly displayName: string }[];
  readonly wolves: readonly WolfGameDefinition[];
  readonly onChange: (patch: DotsSetupDraft) => void;
  readonly v2Supported?: boolean;
  readonly individualPlayerCounts?: readonly number[];
}) {
  const [expanded, setExpanded] = useState<DotsSpecialKind | null>(null);
  const helpId = useId();
  const group = groups.find((entry) => entry.number === draft.groupNumber);
  const linked = wolves.find((game) => game.id === draft.linkedGameId);
  const specials = draft.dotsSpecials ?? [];
  const mode = draft.dotsMode ?? 'individual';
  const solo = mode === 'individual' && group?.playerIds.length === 1;
  const smallGroup = group !== undefined && group.playerIds.length !== 4;
  const supportsGroup = (size: number) => mode === 'individual'
    ? size >= 1 && size <= 4 && individualPlayerCounts.includes(size) : size === 4;
  const compatible = (kind: DotsSpecialKind, selectedMode: DotsGameDefinition['mode']) =>
    (kind !== 'sweep' || selectedMode === 'linked') && (kind !== 'assassin' || selectedMode !== 'individual');
  const available = dotsSpecialCatalog.filter((special) => compatible(special.kind, mode));
  const allSelected = available.every((special) => specials.some((entry) => entry.kind === special.kind));
  return <section className="dots-settings" aria-label="Dots setup">
    <div className="dots-setup-fields">
    <label>Dots playing group<select value={draft.groupNumber ?? ''} onChange={(event) => {
      const selected = groups.find((entry) => entry.number === Number(event.target.value));
      if (selected && supportsGroup(selected.playerIds.length)) onChange({ groupNumber: selected.number,
        dotsPlayers: selected.playerIds, dotsPlayerIds: selected.playerIds, linkedGameId: '',
        ...(selected.playerIds.length === 1 ? { stake: '' } : {}) });
    }}><option value="">Choose saved playing group</option>{groups.filter((entry) =>
      supportsGroup(entry.playerIds.length) || entry.number === draft.groupNumber).map((entry) =>
      <option key={entry.number} value={entry.number} disabled={!supportsGroup(entry.playerIds.length)}>
        Group {entry.number}{entry.playerIds.length === 4 ? '' : ` · ${String(entry.playerIds.length)} ${entry.playerIds.length === 1 ? 'player' : 'players'}`}</option>)}</select></label>
    <label>Dots mode<select value={mode === 'rotating' ? `rotating-${String(draft.dotsRotationHoles ?? 3)}` : mode} onChange={(event) => {
      const selectedMode = event.target.value;
      if (smallGroup && selectedMode !== 'individual') return;
      if ((selectedMode === 'rotating-3' || selectedMode === 'rotating-6') && v2Supported && draft.dotsVersion !== 1) {
        onChange({ dotsMode: 'rotating', dotsRotationHoles: selectedMode === 'rotating-3' ? 3 : 6,
          dotsSpecials: specials.filter((special) => compatible(special.kind, 'rotating')) });
        return;
      }
      if ((selectedMode === 'individual' || selectedMode === 'fixed' || selectedMode === 'linked') && selectedMode !== mode) {
        if (draft.dotsVersion === 2) return;
        onChange({ dotsMode: selectedMode, dotsSpecials: specials.filter((special) => compatible(special.kind, selectedMode)) });
      }
    }}><option value="rotating-3" disabled={smallGroup || !v2Supported || draft.dotsVersion === 1}>Modified Sixes · Change partners every 3 holes</option>
      <option value="rotating-6" disabled={smallGroup || !v2Supported || draft.dotsVersion === 1}>Sixes · Change partners every 6 holes</option>
      <option value="individual" disabled={draft.dotsVersion === 2}>Individual</option><option value="fixed" disabled={smallGroup || draft.dotsVersion === 2}>Fixed partners</option>
      <option value="linked" disabled={smallGroup || draft.dotsVersion === 2}>Link to earned Wolf</option></select></label>
    </div>
    {mode === 'individual' && smallGroup && !supportsGroup(group.playerIds.length)
      && <p role="alert">This API does not support individual Dots for this group size. Refresh after an API upgrade; your draft is retained.</p>}
    {smallGroup && <small>Partner modes require four players.</small>}
    {mode === 'rotating' && <p>Choose P1–P4 on your first played hole in score entry. Partners rotate in your playing circuit; only specials are shared, with no base match points.</p>}
    {draft.dotsVersion === 1 && <small>Saved version-1 rules stay unchanged. Create a separate rotating Dots game before scoring to use Modified Sixes or Sixes.</small>}
    {!v2Supported && <small>Rotating Dots requires advertised API version-2 support.</small>}
    <small>Changing mode clears incompatible specials.</small>
    {draft.dotsMode === 'linked' ? <>
      <label>Linked game<select value={draft.linkedGameId ?? ''} onChange={(event) => { onChange({ linkedGameId: event.target.value }); }}>
        <option value="">Choose compatible Wolf game</option>{wolves.filter((game) => game.version === 2 && game.groupNumber === draft.groupNumber).map((game) =>
          <option key={game.id} value={game.id}>{game.name}</option>)}</select></label>
      <p className="dots-linked-rate">Wolf sides and multiplier · Shared rate: {linked?.stakeMinor == null
        ? 'No money configured' : `${formatMoney(linked.stakeMinor, 'USD')} per dot difference`}</p>
    </> : solo ? <>
      <p>Solo stats only · No money or opponent payments.</p>
      {draft.stake?.trim() && Number(draft.stake) !== 0 && <button type="button" onClick={() => { onChange({ stake: '' }); }}>Clear planned rate for solo play</button>}
    </> : <>
      {draft.dotsMode === 'fixed' && (draft.dotsPlayers ?? []).map((id, index) => <label key={index}>
        Side {index < 2 ? 'A' : 'B'} golfer {index % 2 + 1}<select value={id} onChange={(event) => {
          const ids = [...(draft.dotsPlayers ?? [])], other = ids.indexOf(event.target.value);
          if (other >= 0) { ids[other] = id; ids[index] = event.target.value; onChange({ dotsPlayers: ids }); }
        }}>{group?.playerIds.map((playerId) => <option key={playerId} value={playerId}>
          {players.find((player) => player.playerId === playerId)?.displayName ?? 'Golfer unavailable'}</option>)}</select></label>)}
      <label className="dots-stake">USD per dot difference<span className="dots-stake-field"><span aria-hidden="true">$</span><input aria-label="USD per dot difference" inputMode="decimal" value={draft.stake ?? ''}
        onChange={(event) => { onChange({ stake: event.target.value }); }} /></span></label>
      <small>Blank or 0: points only. Enter dollars, e.g. .50.</small>
    </>}
    <fieldset className="dots-specials" aria-label="Enabled specials and whole-dot units">
      <legend>Specials</legend>
      <div className="dots-specials-toolbar">
        <small>{specials.length} selected · Whole-dot values</small>
        <button type="button" disabled={allSelected} onClick={() => {
          onChange({ dotsSpecials: [...specials, ...available.filter((special) =>
            !specials.some((entry) => entry.kind === special.kind)).map((special) => ({
            kind: special.kind, units: special.defaultUnits,
          }))] });
        }}>Select all</button>
      </div>
      <div className="dots-specials-grid">{dotsSpecialCatalog.map((special) => {
      const selected = specials.find((entry) => entry.kind === special.kind);
      const incompatible = !compatible(special.kind, mode);
      const descriptionId = `${helpId}-${special.kind}`;
      return <div className="dots-special" key={special.kind}>
        <div className="dots-special-row">
        <label className="dots-special-toggle"><input type="checkbox" checked={selected !== undefined}
          aria-label={`${special.label}${special.automatic ? ' · Automatic' : ''}`}
          disabled={incompatible}
          onChange={(event) => { onChange({ dotsSpecials: event.target.checked
            ? [...specials, { kind: special.kind, units: special.defaultUnits }] : specials.filter((entry) => entry.kind !== special.kind) }); }} />
          <span>{special.label}{special.automatic && <span className="dots-special-auto" aria-hidden="true">Auto</span>}</span>
        </label>
        {selected && <input className="dots-special-units" aria-label={`${special.label} units`} type="number" min="1" step="1" value={selected.units}
          disabled={incompatible}
          onChange={(event) => { onChange({ dotsSpecials: specials.map((entry) => entry.kind === special.kind
            ? { ...entry, units: event.target.value === '' ? 0 : Number(event.target.value) } : entry) }); }} />}
        <button type="button" className="dots-special-info" aria-label={`About ${special.label}`}
          aria-expanded={expanded === special.kind} aria-controls={descriptionId}
          onClick={() => { setExpanded((current) => current === special.kind ? null : special.kind); }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <circle cx="12" cy="12" r="9" /><path d="M12 11v6" />
            <circle cx="12" cy="7" r=".8" fill="currentColor" stroke="none" />
          </svg>
        </button>
        </div>
        {expanded === special.kind && <p className="dots-special-description" id={descriptionId}>{special.description}</p>}
        {incompatible && <small className="dots-special-reason">{special.kind === 'sweep' ? 'Sweep requires a linked game with actual High and Low results.'
          : 'Assassin requires partnered 2-v-2 play, not individual mode.'}
          {selected && ' This saved selection is retained for review; change mode before saving.'}</small>}
      </div>;
    })}</div></fieldset>
  </section>;
}
