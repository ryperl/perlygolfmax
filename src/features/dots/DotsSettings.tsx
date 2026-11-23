import type { DotsGameDefinition, DotsSpecialKind, DotsSpecialSelection } from '../../domain/dots';
import type { DotPresetStore } from '../../client/dot-presets';
import type { RoundGroup } from '../../domain/setup';
import type { WolfGameDefinition } from '../../domain/wolf';
import type { GameHandicapRule } from '../../domain/game-handicaps';
import { gameHandicap } from '../../domain/game-handicaps';
import type { PlayerCourseHandicap } from '../../domain/scoring';
import { dotsSpecialCatalog } from '../../domain/dots';
import { formatMoney, parseMoney } from '../../domain/money';
import { DotSpecialsSettings } from './DotSpecialsSettings';
import { dotSpecialModeCompatible } from './dot-preset-options';
import './dots-settings.css';

export interface DotsSetupDraft {
  readonly groupNumber?: number;
  readonly dotsMode?: DotsGameDefinition['mode'];
  readonly dotsVersion?: 1 | 2 | 3;
  readonly dotsOrderMode?: 'tee-flip' | 'approach';
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
  supportedKinds, presetStore, hidePlayingGroup = false, manualSweepSupported = false, highLowSupported = false,
  v3Supported = false, locked = false, handicaps = [], defaultStartingHole, existing = true }: {
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
  readonly v3Supported?: boolean;
  readonly locked?: boolean;
  readonly handicaps?: readonly PlayerCourseHandicap[];
  readonly defaultStartingHole?: number | undefined;
  readonly existing?: boolean;
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
  const updated = draft.dotsVersion === 3;
  const rule = draft.dotsHighLowHandicapRule ?? 'full-course-v1';
  const netAvailable = updated ? v3Supported : highLowSupported;
  const name = (id: string) => players.find((player) => player.playerId === id)?.displayName ?? 'Golfer unavailable';
  const format = (value: number | null) => value === null ? 'Unavailable' : value < 0 ? `+${String(-value)}` : String(value);
  const rate = draft.stake?.trim() ? parseMoney(draft.stake) : 0;
  return <section className="dots-settings" aria-label="Dots setup">
    <h4>1. Game format</h4>
    <div className="dots-setup-fields">
    {!hidePlayingGroup && <DotsPlayingGroupSelect draft={draft} groups={groups} onChange={onChange} individualPlayerCounts={individualPlayerCounts} />}
    <label>Dots mode<select value={mode === 'rotating' ? `rotating-${String(draft.dotsRotationHoles ?? 3)}` : mode} onChange={(event) => {
      const selectedMode = event.target.value;
      if (smallGroup && selectedMode !== 'individual') return;
      if ((selectedMode === 'rotating-3' || selectedMode === 'rotating-6') && v2Supported && (!existing || draft.dotsVersion !== 1)) {
        if (updated && !v3Supported) return;
        const nextVersion = v3Supported && (!existing || draft.dotsVersion !== 2) ? 3 : 2;
        onChange({ dotsMode: 'rotating', dotsRotationHoles: selectedMode === 'rotating-3' ? 3 : 6,
          ...(nextVersion === 3 ? { dotsVersion: 3, dotsOrderMode: draft.dotsOrderMode ?? 'tee-flip' } : {}),
          ...(nextVersion !== 3 && selectedMode === 'rotating-6' && draft.dotsHighLow ? { dotsHighLow: false } : {}),
          dotsSpecials: specials.filter((special) => compatible(special.kind, 'rotating')) });
        return;
      }
      if ((selectedMode === 'individual' || selectedMode === 'fixed' || selectedMode === 'linked') && selectedMode !== mode) {
        if (existing && (draft.dotsVersion === 2 || updated)) return;
        onChange({ dotsMode: selectedMode, ...(!existing ? { dotsVersion: 1 } : {}), ...(draft.dotsHighLow ? { dotsHighLow: false } : {}),
          dotsSpecials: specials.filter((special) => compatible(special.kind, selectedMode)) });
      }
    }}><option value="rotating-3" disabled={smallGroup || !v2Supported || existing && draft.dotsVersion === 1}>Modified Sixes · Change partners every 3 holes</option>
      <option value="rotating-6" disabled={smallGroup || !v2Supported || existing && draft.dotsVersion === 1}>Sixes · Change partners every 6 holes</option>
      <option value="individual" disabled={existing && (draft.dotsVersion === 2 || updated)}>Individual</option><option value="fixed" disabled={smallGroup || existing && (draft.dotsVersion === 2 || updated)}>Fixed partners</option>
      <option value="linked" disabled={smallGroup || existing && (draft.dotsVersion === 2 || updated)}>Link to earned Wolf</option></select></label>
    </div>
    {mode === 'individual' && smallGroup && !supportsGroup(mode, group.playerIds.length, individualPlayerCounts)
      && <p role="alert">Individual Dots for this group size is temporarily unavailable in this app version. Your draft is retained.</p>}
    {smallGroup && <small>Partner modes require four players.</small>}
    {mode === 'rotating' && <section aria-label="First teams">
      <h4>2. First teams</h4>
      {updated ? <>
        <label>Choose first teams by<select value={draft.dotsOrderMode ?? 'tee-flip'} disabled={locked || !v3Supported}
          onChange={(event) => {
            const method = event.target.value;
            if (method === 'tee-flip' || method === 'approach') onChange({ dotsOrderMode: method });
          }}>
          <option value="tee-flip">Tee flip · Choose first through fourth</option>
          <option value="approach">Approach ranking · Closest through farthest</option>
        </select></label>
        <p>{draft.dotsOrderMode === 'approach'
          ? 'On your first played hole, rank the approaches. Closest + farthest play the middle two.'
          : 'On the first tee, choose the flip order. First + second play third + fourth.'}</p>
        {!v3Supported && <small>These team and scoring rules are temporarily unavailable. Your draft is kept.</small>}
      </> : <>
        <p>Choose P1–P4 on your first played hole in score entry. Partners rotate in your playing circuit.</p>
        {draft.dotsVersion === 2 && v3Supported && !locked && <button type="button"
          onClick={() => { onChange({ dotsVersion: 3, dotsOrderMode: 'tee-flip' }); }}>
          Use updated team and scoring rules</button>}
      </>}
      <small>Names are chosen in score entry, not now. Saving that order locks it for this game.</small>
    </section>}
    {mode === 'rotating' && (updated || (draft.dotsRotationHoles ?? 3) === 3) && <section aria-label="High/Low scoring">
      <h4>3. Scoring</h4>
      <label><input type="checkbox" checked={draft.dotsHighLow === true} disabled={locked || !netAvailable}
        onChange={(event) => { onChange({ dotsHighLow: event.target.checked }); }} />Net High/Low</label>
      {draft.dotsHighLow && <>
        <label>High/Low net strokes<select value={rule} disabled={locked || !netAvailable}
          onChange={(event) => {
            const rule = event.target.value;
            if (rule === 'full-course-v1' || rule === 'group-low-v1') onChange({ dotsHighLowHandicapRule: rule });
          }}>
          <option value="full-course-v1">Full Course Handicap</option>
          <option value="group-low-v1">SO · Off lowest player in saved group</option>
        </select></label>
        <small>High and Low each earn one dot per winning teammate. Ties push; no carry. Specials still use gross scores.</small>
        {updated && <p>Automatic High/Low Sweep: win both contests and each teammate earns one extra dot.
          High 1 + Low 1 + Sweep 1 = 3 each. Do not enter this bonus manually.</p>}
        {handicaps.length > 0 && group && <div className="game-scroll"><table>
          <caption>Net handicap preview · Freezes with first saved scoring</caption>
          <thead><tr><th scope="col">Golfer</th><th scope="col">CH</th><th scope="col">{rule === 'group-low-v1' ? 'SO' : 'Used for net'}</th></tr></thead>
          <tbody>{group.playerIds.map((id) => {
            const ch = handicaps.find((entry) => entry.playerId === id)?.courseHandicap ?? null;
            const used = gameHandicap(rule, id, handicaps.map((entry) => ({
              playerId: entry.playerId, handicap: entry.courseHandicap ?? entry.unavailableReason ?? null,
            })), groups);
            return <tr key={id}><th scope="row">{name(id)}</th><td>{format(ch)}</td>
              <td>{format(typeof used === 'number' ? used : null)}</td></tr>;
          })}</tbody>
        </table></div>}
      </>}
      {!netAvailable && <small>Net High/Low is temporarily unavailable in this app version.</small>}
    </section>}
    {mode === 'rotating' && !draft.dotsHighLow && <small>Specials only · No base match points.</small>}
    {existing && draft.dotsVersion === 1 && <small>Saved version-1 rules stay unchanged. Create a separate rotating Dots game before scoring to use Modified Sixes or Sixes.</small>}
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
    <h4>{mode === 'rotating' ? '4. Special dots' : 'Special dots'}</h4>
    <small>Qualifying scores are gross. Automatic dots are calculated from saved scores and selections.</small>
    <details open={!updated}><summary>Choose special dots ({specials.length})</summary>
    <DotSpecialsSettings specials={specials} mode={mode} manualSweep={manualSweep}
      {...(supportedKinds === undefined ? {} : { supportedKinds })}
      {...(presetStore === undefined ? {} : { presetStore })}
      onChange={(dotsSpecials) => { onChange({ dotsSpecials,
        ...(manualSweep && dotsSpecials.some((special) => special.kind === 'sweep') ? { dotsSweepRule: 'manual-v1' } : {}) }); }} />
    </details>
    {specials.some((special) => special.kind === 'long-drive') && specials.some((special) => special.kind === 'blue-plate')
      && <small>Automatic Category Sweep: the same golfer wins Long Drive and Blue Plate on one hole, +1 for each teammate.</small>}
    {manualSweep && specials.some((special) => special.kind === 'sweep') &&
      <small>Manual Sweep is a separate agreed bonus. Never enter it to repeat an automatic sweep.</small>}
    {specials.some((special) => special.kind === 'king-of-the-hill') &&
      <small>King of the Hill is an individual round bonus, not a shared hole award.</small>}
    {mode === 'rotating' && <section aria-label="Review Dots setup">
      <h4>5. Review before saving</h4>
      <p>{(draft.dotsRotationHoles ?? 3) === 3 ? 'Modified Sixes' : 'Sixes'} · Group {draft.groupNumber ?? 'not chosen'}
        {' · '}Start: {group?.startingHole ?? defaultStartingHole ?? 'round default'} · Partners change every {draft.dotsRotationHoles ?? 3} played holes.</p>
      {group && <p>{group.playerIds.map(name).join(' · ')}</p>}
      {updated && <p>{draft.dotsOrderMode === 'approach' ? 'Approach ranking: closest + farthest versus middle two.'
        : 'Tee flip: first + second versus third + fourth.'}</p>}
      <p>{draft.dotsHighLow ? `${rule === 'group-low-v1' ? 'Off lowest golfer' : 'Full Course Handicap'} · Net High/Low${updated ? ' + automatic High/Low Sweep' : ''}`
        : 'Specials-only sharing; no High/Low contest.'} · Special scores stay gross.</p>
      <p>{rate === null ? 'Check the USD rate before saving.' : rate === 0 ? 'Points only · No money configured.'
        : `${formatMoney(rate, 'USD')} per dot difference · Planned settlement, not paid.`}</p>
      <details><summary>Selected special dots ({specials.length})</summary>
        <p>{specials.map((special) => `${special.kind === 'sweep' && manualSweep ? 'Manual Sweep'
          : dotsSpecialCatalog.find((entry) => entry.kind === special.kind)?.label ?? special.kind}: ${String(special.units)}`).join(' · ') || 'None selected'}</p>
      </details>
    </section>}
  </section>;
}
