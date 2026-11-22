import type { DotsGameDefinition, DotsSpecialKind, DotsSpecialSelection } from '../../domain/dots';
import type { DotPresetStore } from '../../client/dot-presets';
import type { RoundGroup } from '../../domain/setup';
import type { WolfGameDefinition } from '../../domain/wolf';
import type { GameHandicapRule } from '../../domain/game-handicaps';
import { formatMoney } from '../../domain/money';
import { DotSpecialsSettings } from './DotSpecialsSettings';
import { dotSpecialModeCompatible } from './dot-preset-options';
import './dots-settings.css';

export interface DotsSetupDraft {
  readonly groupNumber?: number;
  readonly dotsMode?: DotsGameDefinition['mode'];
  readonly dotsVersion?: 1 | 2;
  readonly dotsRotationHoles?: 3 | 6;
  readonly dotsHighLow?: boolean;
  readonly dotsHighLowHandicapRule?: GameHandicapRule;
  readonly dotsPlayers?: readonly string[];
  readonly dotsPlayerIds?: readonly string[];
  readonly dotsSpecials?: readonly DotsSpecialSelection[];
  readonly dotsSweepRule?: 'manual-v1';
  readonly dotsLegacySweep?: boolean;
  readonly linkedGameId?: string;
  readonly stake?: string;
}

interface DotsPlayingGroupProps {
  readonly draft: DotsSetupDraft;
  readonly groups: readonly RoundGroup[];
  readonly onChange: (patch: DotsSetupDraft) => void;
  readonly individualPlayerCounts?: readonly number[];
}

function supportsGroup(mode: DotsGameDefinition['mode'], size: number, individualPlayerCounts: readonly number[]) {
  return mode === 'individual' ? size >= 1 && size <= 4 && individualPlayerCounts.includes(size) : size === 4;
}

export function DotsPlayingGroupSelect({ draft, groups, onChange, individualPlayerCounts = [4] }: DotsPlayingGroupProps) {
  const eligible = (size: number) => supportsGroup(draft.dotsMode ?? 'individual', size, individualPlayerCounts);
  return <label>Dots playing group<select value={draft.groupNumber ?? ''} onChange={(event) => {
    const selected = groups.find((entry) => entry.number === Number(event.target.value));
    if (selected && eligible(selected.playerIds.length)) onChange({ groupNumber: selected.number,
      dotsPlayers: selected.playerIds, dotsPlayerIds: selected.playerIds, linkedGameId: '',
      ...(selected.playerIds.length === 1 ? { stake: '' } : {}) });
  }}><option value="">Choose saved playing group</option>{groups.filter((entry) =>
    eligible(entry.playerIds.length) || entry.number === draft.groupNumber).map((entry) =>
    <option key={entry.number} value={entry.number} disabled={!eligible(entry.playerIds.length)}>
      Group {entry.number}{entry.playerIds.length === 4 ? '' : ` · ${String(entry.playerIds.length)} ${entry.playerIds.length === 1 ? 'player' : 'players'}`}</option>)}</select></label>;
}

export function DotsSettings({ draft, groups, players, wolves, onChange, v2Supported = false, individualPlayerCounts = [4],
  supportedKinds, presetStore, hidePlayingGroup = false, manualSweepSupported = false, highLowSupported = false }: {
  readonly draft: DotsSetupDraft;
  readonly groups: readonly RoundGroup[];
  readonly players: readonly { readonly playerId: string; readonly displayName: string }[];
  readonly wolves: readonly WolfGameDefinition[];
  readonly onChange: (patch: DotsSetupDraft) => void;
  readonly v2Supported?: boolean;
  readonly individualPlayerCounts?: readonly number[];
  readonly supportedKinds?: readonly DotsSpecialKind[];
  readonly presetStore?: DotPresetStore;
  readonly hidePlayingGroup?: boolean;
  readonly manualSweepSupported?: boolean;
  readonly highLowSupported?: boolean;
}) {
  const group = groups.find((entry) => entry.number === draft.groupNumber);
  const linked = wolves.find((game) => game.id === draft.linkedGameId);
  const specials = draft.dotsSpecials ?? [];
  const mode = draft.dotsMode ?? 'individual';
  const solo = mode === 'individual' && group?.playerIds.length === 1;
  const smallGroup = group !== undefined && group.playerIds.length !== 4;
  const legacySweep = draft.dotsLegacySweep === true && draft.dotsSweepRule !== 'manual-v1';
  const manualSweep = draft.dotsSweepRule === 'manual-v1' || manualSweepSupported && !legacySweep;
  const compatible = (kind: DotsSpecialKind, mode: DotsGameDefinition['mode']) => dotSpecialModeCompatible(kind, mode, manualSweep);
  return <section className="dots-settings" aria-label="Dots setup">
    <div className="dots-setup-fields">
    {!hidePlayingGroup && <DotsPlayingGroupSelect draft={draft} groups={groups} onChange={onChange} individualPlayerCounts={individualPlayerCounts} />}
    <label>Dots mode<select value={mode === 'rotating' ? `rotating-${String(draft.dotsRotationHoles ?? 3)}` : mode} onChange={(event) => {
      const selectedMode = event.target.value;
      if (smallGroup && selectedMode !== 'individual') return;
      if ((selectedMode === 'rotating-3' || selectedMode === 'rotating-6') && v2Supported && draft.dotsVersion !== 1) {
        onChange({ dotsMode: 'rotating', dotsRotationHoles: selectedMode === 'rotating-3' ? 3 : 6,
          ...(selectedMode === 'rotating-6' && draft.dotsHighLow ? { dotsHighLow: false } : {}),
          dotsSpecials: specials.filter((special) => compatible(special.kind, 'rotating')) });
        return;
      }
      if ((selectedMode === 'individual' || selectedMode === 'fixed' || selectedMode === 'linked') && selectedMode !== mode) {
        if (draft.dotsVersion === 2) return;
        onChange({ dotsMode: selectedMode, ...(draft.dotsHighLow ? { dotsHighLow: false } : {}),
          dotsSpecials: specials.filter((special) => compatible(special.kind, selectedMode)) });
      }
    }}><option value="rotating-3" disabled={smallGroup || !v2Supported || draft.dotsVersion === 1}>Modified Sixes · Change partners every 3 holes</option>
      <option value="rotating-6" disabled={smallGroup || !v2Supported || draft.dotsVersion === 1}>Sixes · Change partners every 6 holes</option>
      <option value="individual" disabled={draft.dotsVersion === 2}>Individual</option><option value="fixed" disabled={smallGroup || draft.dotsVersion === 2}>Fixed partners</option>
      <option value="linked" disabled={smallGroup || draft.dotsVersion === 2}>Link to earned Wolf</option></select></label>
    </div>
    {mode === 'individual' && smallGroup && !supportsGroup(mode, group.playerIds.length, individualPlayerCounts)
      && <p role="alert">Individual Dots for this group size is temporarily unavailable in this app version. Your draft is retained.</p>}
    {smallGroup && <small>Partner modes require four players.</small>}
    {mode === 'rotating' && <p>Choose P1–P4 on your first played hole in score entry. Partners rotate in your playing circuit.</p>}
    {mode === 'rotating' && (draft.dotsRotationHoles ?? 3) === 3 && <>
      <label><input type="checkbox" checked={draft.dotsHighLow === true} disabled={!highLowSupported}
        onChange={(event) => { onChange({ dotsHighLow: event.target.checked }); }} />Net High/Low</label>
      {draft.dotsHighLow && <>
        <label>High/Low net strokes<select value={draft.dotsHighLowHandicapRule ?? 'full-course-v1'} disabled={!highLowSupported}
          onChange={(event) => {
            const rule = event.target.value;
            if (rule === 'full-course-v1' || rule === 'group-low-v1') onChange({ dotsHighLowHandicapRule: rule });
          }}>
          <option value="full-course-v1">Full Course Handicap</option>
          <option value="group-low-v1">SO · Off lowest player in saved group</option>
        </select></label>
        <small>High and Low each earn one dot per winning teammate. Ties push; no carry. Specials still use gross scores.</small>
      </>}
      {!highLowSupported && <small>Net High/Low is temporarily unavailable in this app version.</small>}
    </>}
    {mode === 'rotating' && !draft.dotsHighLow && <small>Specials only · No base match points.</small>}
    {draft.dotsVersion === 1 && <small>Saved version-1 rules stay unchanged. Create a separate rotating Dots game before scoring to use Modified Sixes or Sixes.</small>}
    {!v2Supported && <small>Rotating Dots is temporarily unavailable in this app version.</small>}
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
        Team {index < 2 ? '1' : '2'} golfer {index % 2 + 1}<select value={id} onChange={(event) => {
          const ids = [...(draft.dotsPlayers ?? [])], other = ids.indexOf(event.target.value);
          if (other >= 0) { ids[other] = id; ids[index] = event.target.value; onChange({ dotsPlayers: ids }); }
        }}>{group?.playerIds.map((playerId) => <option key={playerId} value={playerId}>
          {players.find((player) => player.playerId === playerId)?.displayName ?? 'Golfer unavailable'}</option>)}</select></label>)}
      <label className="dots-stake">USD per dot difference<span className="dots-stake-field"><span aria-hidden="true">$</span><input aria-label="USD per dot difference" inputMode="decimal" value={draft.stake ?? ''}
        onChange={(event) => { onChange({ stake: event.target.value }); }} /></span></label>
      <small>Blank or 0: points only. Enter dollars, e.g. .50.</small>
    </>}
    {legacySweep && <p>Saved legacy Sweep awards linked High/Low wins. It stays automatic until you explicitly change it before scoring.</p>}
    {legacySweep && manualSweepSupported && <button type="button" onClick={() => {
      onChange({ dotsSweepRule: 'manual-v1', dotsLegacySweep: false });
    }}>Use manual Sweep</button>}
    {!manualSweepSupported && <small>Manual Sweep is temporarily unavailable in this app version.</small>}
    <DotSpecialsSettings specials={specials} mode={mode} manualSweep={manualSweep}
      {...(supportedKinds === undefined ? {} : { supportedKinds })}
      {...(presetStore === undefined ? {} : { presetStore })}
      onChange={(dotsSpecials) => { onChange({ dotsSpecials,
        ...(manualSweep && dotsSpecials.some((special) => special.kind === 'sweep') ? { dotsSweepRule: 'manual-v1' } : {}) }); }} />
  </section>;
}
