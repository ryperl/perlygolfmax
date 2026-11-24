import { useEffect, useRef, useState } from 'react';
import { needsUpdatedGameCalculations } from '../../contracts/game-calculations';
import { EventChangedError } from '../../client/events';
import type { DotPresetStore } from '../../client/dot-presets';
import type { RoundGameDefinition } from '../../domain/games';
import { changesSkinsCarryRules, maximumGamesPerRound, sameGameDefinitions, visibleGames } from '../../domain/games';
import type { GameWriteResult, RoundScores } from '../../domain/scoring';
import { scorePermissions, supportsDotsSpecials, supportsIndividualDotsPlayerCount, supportsRoundGame, supportsDotsGameRules } from '../../domain/scoring';
import type { GameDraft } from './game-draft';
import { buildGame, defaultGameGroup, dotsDraftProblem, draftFromGame, newGameDraft, replaceGame, setGameKind } from './game-draft';
import { GameResults } from './GameResults';
import { GameSettings } from './GameSettings';
import { canManageAllRoundGames, canManageGame, canManageRoundGames } from './game-permissions';
import { InternalSettlement } from '../dots';
import { gameDisplayName } from './game-presentation';
import { dotsSpecialCatalog } from '../../domain/dots';
import { hasCustomChurchyName } from '../../contracts/churchy-names';
import { hasGameHandicapRules } from '../../contracts/game-handicaps';
import { skinsCarryCircuit } from '../../domain/round-navigation';
import './games.css';

export interface RoundGamesPanelProps {
  readonly round: RoundScores;
  readonly busy: boolean;
  readonly onDirtyChange: (dirty: boolean) => void;
  readonly onSave: (games: readonly RoundGameDefinition[], etag: string | null, requestId: string) => Promise<GameWriteResult | null>;
  readonly onRefresh: () => Promise<RoundScores | null>;
  readonly presetStore?: DotPresetStore | undefined;
  readonly initialAdd?: boolean;
  readonly defaultGroupNumber?: number | undefined;
}

interface Attempt {
  readonly games: readonly RoundGameDefinition[];
  readonly etag: string | null;
  readonly id: string;
}

interface Editor {
  readonly draft: GameDraft;
  readonly base: readonly RoundGameDefinition[];
  readonly etag: string | null;
  readonly attempt: Attempt | null;
  readonly conflict: boolean;
  readonly latest: RoundScores | null;
  readonly roster: RoundScores['cards'];
  readonly context: RoundScores;
}

function createEditor(round: RoundScores, game?: RoundGameDefinition, defaultGroupNumber?: number): Editor {
  const draft = game ? draftFromGame(game) : canManageAllRoundGames(round) ? newGameDraft(round.gameHandicapRules === 1)
    : defaultGameGroup(setGameKind(newGameDraft(), 'dots', round.cards.length), round.groups,
      [1, 2, 3, 4].filter((count) => supportsIndividualDotsPlayerCount(round, count)), defaultGroupNumber);
  return {
    draft, base: round.games?.configuration.games ?? [], etag: round.games?.configuration.etag ?? null,
    attempt: null, conflict: false, latest: null, roster: round.cards, context: round,
  };
}

export function RoundGamesPanel({ round, busy, onDirtyChange, onSave, onRefresh, presetStore, initialAdd, defaultGroupNumber }: RoundGamesPanelProps) {
  const accessKey = JSON.stringify([scorePermissions(round), round.quickRound === true]);
  const [initial, setInitial] = useState(() => ({ accessKey, add: initialAdd === true }));
  if (initial.accessKey !== accessKey) setInitial({ accessKey, add: false });
  if (round.eventStatus === 'archived' && scorePermissions(round).role !== 'owner') return <p role="alert">Archived game results are available to the event owner only.</p>;
  return <RoundGamesController key={accessKey} round={round} busy={busy}
    onDirtyChange={onDirtyChange} onSave={onSave} onRefresh={onRefresh} presetStore={presetStore}
    initialAdd={initial.accessKey === accessKey && initial.add} defaultGroupNumber={defaultGroupNumber} />;
}

function RoundGamesController({ round, busy, onDirtyChange, onSave, onRefresh, presetStore, initialAdd = false, defaultGroupNumber }: RoundGamesPanelProps) {
  const [editor, setEditor] = useState<Editor | null>(() =>
    initialAdd && !busy && round.eventStatus !== 'archived' && canManageRoundGames(round)
      && (round.games?.configuration.games.length ?? 0) < maximumGamesPerRound ? createEditor(round, undefined, defaultGroupNumber) : null);
  const [message, setMessage] = useState('');
  const [working, setWorking] = useState(false);
  const inFlight = useRef(false);
  const dirtyCallback = useRef(onDirtyChange);
  const initiallyEditing = useRef(editor !== null);
  const games = round.games?.configuration.games ?? [];
  const archived = round.eventStatus === 'archived';
  const editingRound = editor?.latest ?? editor?.context ?? round;
  const canManage = canManageRoundGames(round) && (!editor?.latest || canManageRoundGames(editor.latest));
  const disabled = busy || working || archived || !canManage;
  const draftGame = editor ? buildGame(editor.draft, editor.roster.map((card) => card.playerId)) : null;
  const sweepDefinitions = [...(editor?.base ?? []), ...(draftGame ? [draftGame] : [])];
  const unsupportedSweep = sweepDefinitions.some((game) => game.kind === 'dots' && game.sweepRule === 'manual-v1')
    && (round.dotsManualSweep !== true || editingRound.dotsManualSweep !== true)
    || sweepDefinitions.some((game) => game.kind === 'wolf' && game.version === 2 && game.highLowSweep === true)
      && (round.wolfHighLowSweep !== true || editingRound.wolfHighLowSweep !== true);
  const unsupportedWolfOrder = sweepDefinitions.some((game) => game.kind === 'wolf' && game.orderMode !== undefined)
    && (round.wolfOrderVersion !== 1 || editingRound.wolfOrderVersion !== 1);
  const unsupportedDotsRules = sweepDefinitions.some((game) => game.kind === 'dots'
    && (!supportsDotsGameRules(round, game) || !supportsDotsGameRules(editingRound, game)));

  useEffect(() => { dirtyCallback.current = onDirtyChange; }, [onDirtyChange]);
  useEffect(() => {
    if (initiallyEditing.current) dirtyCallback.current(true);
    return () => { dirtyCallback.current(false); };
  }, []);

  function open(game?: RoundGameDefinition) {
    if (disabled || editor || !game && games.length >= maximumGamesPerRound) return;
    if (game && !canManageGame(round, game)) return;
    if (game && !supportsRoundGame(round, game.kind ?? 'stableford')) return;
    if (game?.kind === 'churchy' && round.churchyEnabled !== true) return;
    onDirtyChange(true);
    setMessage('');
    setEditor(createEditor(round, game, defaultGroupNumber));
  }

  function change(draft: GameDraft) {
    if (!editor || disabled) return;
    setEditor({ ...editor, draft, attempt: null });
    if (!editor.conflict) setMessage('');
  }

  async function save() {
    if (!editor || disabled || editor.conflict || inFlight.current) return;
    if (!supportsRoundGame(round, editor.draft.kind ?? 'stableford') || !supportsRoundGame(editingRound, editor.draft.kind ?? 'stableford')) {
      setMessage('Editing this game is temporarily unavailable in this app version. Your draft is retained.');
      return;
    }
    if ((round.setupLocked || editingRound.setupLocked) && (editor.draft.kind === 'nassau' || editor.draft.kind === 'match-play' || editor.draft.kind === 'wolf' || editor.draft.kind === 'dots')) {
      setMessage('Dots, Nassau, Match Play and Wolf must be configured before the first saved score. Other game settings remain editable.');
      return;
    }
    if (editor.draft.kind === 'churchy' && round.churchyEnabled !== true) {
      setMessage('Churchie disabled. Cancel editing and refresh; ordinary scores and other games remain available.');
      return;
    }
    const game = buildGame(editor.draft, editor.roster.map((card) => card.playerId));
    const previousGame = editor.base.find((entry) => entry.id === editor.draft.id);
    if (game && hasGameHandicapRules(game)
      && (round.gameHandicapRules !== 1 || editingRound.gameHandicapRules !== 1)) {
      setMessage('These handicap or carry options are temporarily unavailable in this app version. Your draft is retained.');
      return;
    }
    if (game && needsUpdatedGameCalculations(editingRound, [game], true)
      && editingRound.gameCalculationsVersion !== 2) {
      setEditor({ ...editor, conflict: true });
      setMessage('This game cannot be saved until the app update is available. Your changes are kept. Use Refresh latest settings to check again.');
      return;
    }
    const previousRule = previousGame && 'handicapRule' in previousGame ? previousGame.handicapRule : undefined;
    if (game && (round.setupLocked || editingRound.setupLocked)
      && (('handicapRule' in game ? game.handicapRule : undefined) !== previousRule
        || game.kind === 'skins' && game.carryOrder !== (previousGame?.kind === 'skins' ? previousGame.carryOrder : undefined))) {
      setMessage('Saved scoring locks the game handicap and starting-hole rules. Your draft is retained.');
      return;
    }
    if (game?.kind === 'skins' && game.carryovers && game.carryOrder === 'shared-group-v1'
      && !skinsCarryCircuit(editingRound.layout.map((hole) => hole.number), editingRound.groups,
        editingRound.cards.map((card) => card.playerId))) {
      setMessage('Skins carryovers require the entire round to be one saved foursome. Change round setup first, or turn carryovers off.');
      return;
    }
    if (game?.kind === 'skins' && game.carryovers && game.carryOrder === undefined
      && changesSkinsCarryRules(game, previousGame)) {
      setMessage('New or changed Skins carryovers require the one-foursome shared circuit. Select the carry order before saving.');
      return;
    }
    const sweepGames = [...editor.base, ...(game ? [game] : [])];
    if (sweepGames.some((entry) => entry.kind === 'dots' && entry.sweepRule === 'manual-v1')
      && (round.dotsManualSweep !== true || editingRound.dotsManualSweep !== true)) {
      setMessage('Manual Sweep is temporarily unavailable in this app version. Your draft is retained.');
      return;
    }
    if (sweepGames.some((entry) => entry.kind === 'wolf' && entry.version === 2 && entry.highLowSweep === true)
      && (round.wolfHighLowSweep !== true || editingRound.wolfHighLowSweep !== true)) {
      setMessage('Wolf High/Low Sweep is temporarily unavailable in this app version. Your draft is retained.');
      return;
    }
    if ([...(previousGame ? [previousGame] : []), ...(game ? [game] : [])].some(hasCustomChurchyName)
      && (round.churchyCustomNames !== true || editingRound.churchyCustomNames !== true)) {
      setMessage('Custom Churchie names are temporarily unavailable in this app version. Your draft is retained.');
      return;
    }
    if (game?.kind === 'dots' && game.mode === 'individual'
      && (!supportsIndividualDotsPlayerCount(round, game.playerIds.length)
        || !supportsIndividualDotsPlayerCount(editingRound, game.playerIds.length))) {
      setMessage('Individual Dots for this group size is temporarily unavailable in this app version. Your draft is retained.');
      return;
    }
    const explicitDotsUpgrade = previousGame?.kind === 'dots' && previousGame.version === 2
      && game?.kind === 'dots' && game.version === 3 && !round.setupLocked && !editingRound.setupLocked;
    if (game?.kind === 'dots' && (previousGame?.kind === 'dots' && previousGame.version !== game.version && !explicitDotsUpgrade
      || !supportsDotsGameRules(round, game) || !supportsDotsGameRules(editingRound, game))) {
      setMessage('Rotating Dots is temporarily unavailable in this app version. Your draft is retained; saved games are unchanged.');
      return;
    }
    if (game?.kind === 'dots' && (!supportsDotsSpecials(round, game.specials) || !supportsDotsSpecials(editingRound, game.specials))) {
      setMessage('These Dots specials are temporarily unavailable in this app version. Your draft is retained.');
      return;
    }
    const explicitChurchyUpgrade = previousGame?.kind === 'churchy' && previousGame.version === 2
      && game?.kind === 'churchy' && game.version === 3 && !round.setupLocked && !editingRound.setupLocked;
    if (game?.kind === 'churchy' && (previousGame?.kind === 'churchy' && previousGame.version !== game.version && !explicitChurchyUpgrade
      || previousGame === undefined && (game.version !== 3 || round.setupLocked || editingRound.setupLocked)
      || game.version !== 1 && (!round.churchyRulesVersions?.includes(game.version) || !editingRound.churchyRulesVersions?.includes(game.version)))) {
      setMessage('Churchie rules support is required before creating or editing this game. Saved rules versions cannot be converted.');
      return;
    }
    if (game?.kind === 'churchy') {
      const selected = editingRound.groups.find((group) => group.number === game.groupNumber);
      if (selected?.playerIds.length !== 4 || game.playerIds.some((id) => !selected.playerIds.includes(id))) {
        setMessage('Choose all four golfers from one saved playing group.');
        return;
      }
      if ((round.setupLocked || editingRound.setupLocked) && previousGame?.kind === 'churchy'
        && !sameGameDefinitions([game], [{ ...previousGame, amountPerDotMinor: game.amountPerDotMinor }])) {
        setMessage('Saved scoring locks the Churchie foursome, order and enabled specials. Only the planned rate can change.');
        return;
      }
    }
    if (game && (!canManageGame(round, game) || !canManageGame(editingRound, game)
      || !canManageAllRoundGames(editingRound) && previousGame !== undefined
        && (!canManageGame(editingRound, previousGame) || previousGame.kind !== game.kind))) {
      setMessage('Editing this game is not available to you right now. Your draft is retained.');
      return;
    }
    if (game?.kind === 'nassau' || game?.kind === 'match-play' || game?.kind === 'wolf' || game?.kind === 'dots') {
      const group = editingRound.groups.find((entry) => entry.number === game.groupNumber);
      const ids = game.kind === 'nassau' || game.kind === 'match-play' ? game.sides.flatMap((side) => side.playerIds) : game.playerIds;
      if (!group || ids.some((id) => !group.playerIds.includes(id))
        || game.kind === 'wolf' && group.playerIds.length !== 4
        || game.kind === 'dots' && (ids.length !== group.playerIds.length
          || (game.mode === 'individual' ? group.playerIds.length < 1 || group.playerIds.length > 4 : group.playerIds.length !== 4))
        || game.kind === 'nassau' && (editingRound.layout.length !== 18 || editingRound.layout.some((hole) => hole.number < 1 || hole.number > 18))) {
        setMessage('Choose participants from one saved playing group. Individual Dots supports 1–4 players; partner modes and Wolf require four. Nassau requires 18 holes.');
        return;
      }
    }
    if (game?.kind === 'dots' || game?.kind === 'wolf' || game?.kind === 'churchy') {
      const peers = editor.base.filter((entry) => entry.id !== game.id);
      if (peers.some((peer) => (peer.kind === 'churchy' || peer.kind === 'wolf' || peer.kind === 'dots')
        && peer.groupNumber === game.groupNumber && (game.kind === 'churchy' || peer.kind === 'churchy'
          || game.kind === 'wolf' && peer.kind === 'wolf'))) {
        setMessage('Choose one internal base game per playing group. Churchie cannot accompany Wolf or Dots; Ball Drop remains separate.');
        return;
      }
      if (game.kind === 'dots' && game.mode === 'linked' && !peers.some((peer) => peer.kind === 'wolf'
        && peer.version === 2 && peer.id === game.linkedGameId && peer.groupNumber === game.groupNumber
        && peer.playerIds.every((id) => game.playerIds.includes(id)))) {
        setMessage('Link Dots to an earned Wolf game in this saved foursome, or choose standalone individual or fixed partners.');
        return;
      }
    }
    const intended = game && replaceGame(editor.base, game);
    if (!intended) {
      setMessage(editor.draft.kind === 'wolf' || editor.draft.kind === 'nassau' || editor.draft.kind === 'match-play'
        ? 'Check the game name, saved playing group, distinct participants and order. Enter USD dollars and cents, or choose No planned money.'
        : editor.draft.kind === 'dots' ? (!game && dotsDraftProblem(editor.draft, editor.roster.map((card) => card.playerId)))
          || 'Choose a saved playing group, compatible mode and enabled specials with positive whole units. Solo play is stats-only; otherwise use a valid optional USD rate with at most two decimal places.'
        : editor.draft.kind === 'churchy'
        ? 'Choose a complete saved foursome, order all four golfers, and enter USD dollars and cents per dot (zero or more). Choose one Churchie game per group.'
        : editor.draft.kind === 'stroke-play' ? 'Check the game name (1–100 characters) and gross or net score basis. Net uses 100% captured Course Handicap.'
        : editor.draft.kind === 'ball-drop' || editor.draft.kind === 'skins'
        ? 'Check the game name (1–100 characters), supported format, and complete four-person Ball Drop teams. Skins are individual; net always uses 100% Course Handicap.'
        : 'Check the game name (1–100 characters), whole-number points, net allowance (1–100), and complete team assignments. Values must be safe integers within the supported points range.');
      return;
    }
    if (intended.some((entry) => entry.kind === 'wolf' && entry.version === 2 && entry.highLowSweep === true
      && intended.some((linked) => linked.kind === 'dots' && linked.mode === 'linked' && linked.linkedGameId === entry.id
        && linked.sweepRule === undefined && linked.specials.some((special) => special.kind === 'sweep')))) {
      setMessage('Remove or explicitly convert the legacy linked Sweep in Dots before enabling Wolf High/Low Sweep.');
      return;
    }
    const attempt = editor.attempt ?? { games: intended, etag: editor.etag, id: crypto.randomUUID() };
    const pending = { ...editor, attempt };
    setEditor(pending);
    setMessage('');
    inFlight.current = true;
    setWorking(true);
    try {
      const result = await onSave(attempt.games, attempt.etag, attempt.id);
      if (!result) {
        setMessage('Save is not confirmed. Your draft is retained; retry when other work finishes.');
        return;
      }
      if (result.change.id !== attempt.id || result.change.expectedEtag !== attempt.etag
        || !sameGameDefinitions(result.change.after, attempt.games)) {
        setMessage('The response did not confirm these settings. Your draft is retained; retry to confirm.');
        return;
      }
      if (!sameGameDefinitions(result.round.games?.configuration.games ?? [], attempt.games)) {
        setEditor({ ...pending, conflict: true, latest: null });
        setMessage('Your save was acknowledged, but the latest settings differ. Refresh and review your game before saving again.');
        return;
      }
      setEditor(null);
      onDirtyChange(false);
      setMessage('Game settings saved.');
    } catch (error) {
      if (error instanceof EventChangedError) {
        setEditor({ ...pending, conflict: true, latest: null });
        setMessage('Game settings changed. Your draft is retained. Refresh, then review your game against the latest settings.');
      } else {
        setMessage(error instanceof Error ? error.message : 'Save failed. Your draft is retained; retry to confirm.');
      }
    } finally {
      inFlight.current = false;
      setWorking(false);
    }
  }

  async function refresh() {
    if (!editor || disabled || inFlight.current) return;
    inFlight.current = true;
    setWorking(true);
    setEditor({ ...editor, latest: null });
    try {
      const latest = await onRefresh();
      if (!latest) {
        setMessage('Refresh is not confirmed. Your draft is retained; try refreshing again.');
      } else if (latest.eventId !== round.eventId || latest.roundId !== round.roundId) {
        setMessage('Refresh returned a different round. Your draft is retained; try refreshing again.');
      } else {
        setEditor({ ...editor, latest });
        setMessage('Latest settings loaded. Review your game before saving.');
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Refresh failed. Your draft is retained.');
    } finally {
      inFlight.current = false;
      setWorking(false);
    }
  }

  function review() {
    if (!editor?.latest || disabled || editor.latest.eventStatus === 'archived'
      || !canManageRoundGames(editor.latest)) return;
    setEditor({
      ...editor, base: editor.latest.games?.configuration.games ?? [],
      etag: editor.latest.games?.configuration.etag ?? null, attempt: null, conflict: false, latest: null,
      roster: editor.latest.cards, context: editor.latest,
    });
    setMessage('Draft reviewed against the latest settings. Other games will be preserved. Save when ready.');
  }

  const previous = editor?.base.filter((game) => game.id === editor.draft.id) ?? [];
  const latestEdited = editor?.latest?.games?.configuration.games.filter((game) => game.id === editor.draft.id) ?? [];
  const editedGameChanged = editor?.latest && !sameGameDefinitions(previous, latestEdited);

  return (
    <section className="round-games" aria-label="Round games">
      <header className="game-round-heading">
        <p className="game-hint">{round.eventName}</p>
        <h2>Games · {round.roundName}</h2>
        <p className="game-hint">{round.courseName} · {(round.playerTees?.length ?? 0) > 0 ? 'Default tee: ' : ''}{round.teeName} / {round.teeCategory}
          {(round.playerTees?.length ?? 0) > 0 && ' · Personal tees assigned; points use each golfer’s captured tee.'}</p>
      </header>
      {archived && <p>This trip is archived. Game settings are read-only.</p>}
      {games.length === 0 && <p>No games configured for this round.</p>}
      {round.internalSettlements?.map((settlement) => <InternalSettlement key={`${String(settlement.groupNumber)}:${settlement.gameIds.join(':')}`}
        settlement={settlement} sourceLabels={settlement.gameIds.length === 2 ? ['Wolf', 'Dots'] : ['Base', 'Specials']}
        provisional={settlement.gameIds.some((id) => !round.games?.results.find((entry) => entry.gameId === id)
          ?.players.every((player) => player.status === 'complete'))}
        gameNames={settlement.gameIds.map((id) => {
          const game = games.find((game) => game.id === id);
          return game ? gameDisplayName(game) : 'Game unavailable';
        })} />)}
      {visibleGames(games, round.churchyEnabled).map((game) => <div className="round-game" key={game.id}>
        {round.internalSettlements?.some((settlement) => settlement.gameIds.includes(game.id)) ? <details>
          <summary>{gameDisplayName(game)} · Game standings</summary>
          <GameResults game={game} result={round.games?.results.find((result) => result.gameId === game.id)}
            holeNumbers={round.layout.map((hole) => hole.number)} players={round.cards} />
        </details> : <GameResults game={game} result={round.games?.results.find((result) => result.gameId === game.id)}
          holeNumbers={round.layout.map((hole) => hole.number)} players={round.cards} />}
        {canManage && (canManageAllRoundGames(round) || canManageGame(round, game)) && <button type="button"
          disabled={disabled || editor !== null || !supportsRoundGame(round, game.kind ?? 'stableford') || !canManageGame(round, game)}
          onClick={() => { open(game); }}>Edit {gameDisplayName(game)}{game.kind === 'churchy'
            && games.filter((entry) => entry.kind === 'churchy').length > 1 ? ` · Group ${String(game.groupNumber)}` : ''}</button>}
        {!supportsRoundGame(round, game.kind ?? 'stableford') && <p>Editing this game is temporarily unavailable in this app version.</p>}
      </div>)}
      {round.setupLocked && games.some((game) => game.kind === 'nassau' || game.kind === 'match-play' || game.kind === 'wolf' || game.kind === 'dots')
        && <p className="game-hint">Setup locked by saved scoring. Score entry retains hole declarations.</p>}
      {!editor && !archived && canManage && <button type="button" disabled={disabled || games.length >= maximumGamesPerRound}
        onClick={() => { open(); }}>Add game</button>}
      {games.length >= maximumGamesPerRound && <p>This round has reached the 16-game limit.</p>}
      {message && <p role="status" className="game-notice">{message}</p>}
      {editor && canManage && (editor.draft.kind !== 'churchy' || round.churchyEnabled === true) && <>
        {editor.conflict && <div className="game-review">
          {editedGameChanged && <p>This game changed in the latest settings. Reviewing keeps your draft for this game and preserves other games.</p>}
          {editor.latest?.eventStatus === 'archived' && <p>The refreshed trip is archived. Your draft is retained, read-only.</p>}
          <div className="game-actions">
            <button type="button" disabled={disabled} onClick={() => { void refresh(); }}>Refresh latest settings</button>
            <button type="button" disabled={disabled || !editor.latest || editor.latest.eventStatus === 'archived'}
              onClick={review}>Review my game against latest settings</button>
          </div>
        </div>}
        <GameSettings draft={editor.draft} disabled={disabled || editor.latest?.eventStatus === 'archived'}
          presetStore={presetStore}
          roster={editor.roster}
          churchyEnabled={round.churchyEnabled === true} groups={editingRound.groups}
          defaultGroupNumber={defaultGroupNumber}
          supportedGameKinds={round.supportedGameKinds?.filter((kind) => supportsRoundGame(editingRound, kind))}
          games={editor.base} internalOnly={!canManageAllRoundGames(editingRound)}
          existing={editor.base.some((game) => game.id === editor.draft.id)}
          wolfV2Supported={round.wolfRulesVersions?.includes(2) === true && editingRound.wolfRulesVersions?.includes(2) === true}
          wolfHighLowSweepSupported={round.wolfHighLowSweep === true && editingRound.wolfHighLowSweep === true}
          wolfOrderSupported={round.wolfOrderVersion === 1 && editingRound.wolfOrderVersion === 1}
          dotsManualSweepSupported={round.dotsManualSweep === true && editingRound.dotsManualSweep === true}
          dotsV2Supported={round.dotsRulesVersions?.includes(2) === true && editingRound.dotsRulesVersions?.includes(2) === true}
          dotsHighLowSupported={round.dotsHighLowVersion !== undefined && editingRound.dotsHighLowVersion !== undefined}
          dotsV3Supported={round.dotsRulesVersions?.includes(3) === true && editingRound.dotsRulesVersions?.includes(3) === true
            && round.dotsHighLowVersion === 2 && editingRound.dotsHighLowVersion === 2}
          courseHandicaps={editingRound.courseHandicaps ?? []}
          dotsSpecialKinds={dotsSpecialCatalog.filter(({ kind }) => supportsDotsSpecials(round, [{ kind, units: 1 }])
            && supportsDotsSpecials(editingRound, [{ kind, units: 1 }])).map((special) => special.kind)}
          dotsIndividualPlayerCounts={([1, 2, 3, 4] as const).filter((count) =>
            supportsIndividualDotsPlayerCount(round, count) && supportsIndividualDotsPlayerCount(editingRound, count))}
          churchyV2Supported={round.churchyRulesVersions?.includes(2) === true && editingRound.churchyRulesVersions?.includes(2) === true}
          churchyV3Supported={round.churchyRulesVersions?.includes(3) === true && editingRound.churchyRulesVersions?.includes(3) === true}
          churchyCustomNamesSupported={round.churchyCustomNames === true && editingRound.churchyCustomNames === true}
          holeNumbers={editingRound.layout.map((hole) => hole.number)}
          gameHandicapsSupported={round.gameHandicapRules === 1 && editingRound.gameHandicapRules === 1}
          setupLocked={round.setupLocked || editingRound.setupLocked}
          allowChurchyCreation={!editor.base.some((game) => game.id === editor.draft.id)}
          saveDisabled={editor.conflict || unsupportedSweep || unsupportedWolfOrder || unsupportedDotsRules} cancelDisabled={working} retry={editor.attempt !== null}
          onChange={change} onSave={() => { void save(); }} onCancel={() => {
            setEditor(null);
            setMessage(editor.attempt ? 'Closing editing does not undo an earlier save. Refresh to see the saved settings.' : '');
            onDirtyChange(false);
          }} />
      </>}
      {editor?.draft.kind === 'churchy' && round.churchyEnabled !== true && <button type="button" disabled={working}
        onClick={() => { setEditor(null); onDirtyChange(false); }}>Cancel unavailable Churchie edit</button>}
    </section>
  );
}
