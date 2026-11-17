import { useEffect, useRef, useState } from 'react';
import { EventChangedError } from '../../client/events';
import type { RoundGameDefinition } from '../../domain/games';
import { maximumGamesPerRound, sameGameDefinitions, visibleGames } from '../../domain/games';
import type { GameWriteResult, RoundScores } from '../../domain/scoring';
import { scorePermissions, supportsRoundGame } from '../../domain/scoring';
import type { GameDraft } from './game-draft';
import { buildGame, draftFromGame, newGameDraft, replaceGame } from './game-draft';
import { GameResults } from './GameResults';
import { GameSettings } from './GameSettings';
import { canManageRoundGames } from './game-permissions';
import './games.css';

export interface RoundGamesPanelProps {
  readonly round: RoundScores;
  readonly busy: boolean;
  readonly onDirtyChange: (dirty: boolean) => void;
  readonly onSave: (games: readonly RoundGameDefinition[], etag: string | null, requestId: string) => Promise<GameWriteResult | null>;
  readonly onRefresh: () => Promise<RoundScores | null>;
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

export function RoundGamesPanel({ round, busy, onDirtyChange, onSave, onRefresh }: RoundGamesPanelProps) {
  if (round.eventStatus === 'archived' && scorePermissions(round).role !== 'owner') return <p role="alert">Archived game results are available to the event owner only.</p>;
  return <RoundGamesController key={JSON.stringify([scorePermissions(round), round.quickRound === true])} round={round} busy={busy}
    onDirtyChange={onDirtyChange} onSave={onSave} onRefresh={onRefresh} />;
}

function RoundGamesController({ round, busy, onDirtyChange, onSave, onRefresh }: RoundGamesPanelProps) {
  const [editor, setEditor] = useState<Editor | null>(null);
  const [message, setMessage] = useState('');
  const [working, setWorking] = useState(false);
  const inFlight = useRef(false);
  const dirtyCallback = useRef(onDirtyChange);
  const games = round.games?.configuration.games ?? [];
  const archived = round.eventStatus === 'archived';
  const editingRound = editor?.latest ?? editor?.context ?? round;
  const canManage = canManageRoundGames(round) && (!editor?.latest || canManageRoundGames(editor.latest));
  const disabled = busy || working || archived || !canManage;

  useEffect(() => { dirtyCallback.current = onDirtyChange; }, [onDirtyChange]);
  useEffect(() => () => { dirtyCallback.current(false); }, []);

  function open(game?: RoundGameDefinition) {
    if (disabled || editor) return;
    if (game && !supportsRoundGame(round, game.kind ?? 'stableford')) return;
    if (game?.kind === 'churchy' && round.churchyEnabled !== true) return;
    const draft = game ? draftFromGame(game) : newGameDraft();
    onDirtyChange(true);
    setMessage('');
    setEditor({
      draft, base: games, etag: round.games?.configuration.etag ?? null,
      attempt: null, conflict: false, latest: null, roster: round.cards, context: round,
    });
  }

  function change(draft: GameDraft) {
    if (!editor || disabled) return;
    setEditor({ ...editor, draft, attempt: null });
    if (!editor.conflict) setMessage('');
  }

  async function save() {
    if (!editor || disabled || editor.conflict || inFlight.current) return;
    if (!supportsRoundGame(round, editor.draft.kind ?? 'stableford') || !supportsRoundGame(editingRound, editor.draft.kind ?? 'stableford')) {
      setMessage('This API does not support editing this game. Your draft is retained.');
      return;
    }
    if ((round.setupLocked || editingRound.setupLocked) && (editor.draft.kind === 'nassau' || editor.draft.kind === 'wolf')) {
      setMessage('Nassau and Wolf must be configured before the first saved score. Other game settings remain editable.');
      return;
    }
    if (editor.draft.kind === 'churchy' && round.churchyEnabled !== true) {
      setMessage('Experimental game disabled. Cancel editing and refresh; ordinary scores and other games remain available.');
      return;
    }
    const game = buildGame(editor.draft, editor.roster.map((card) => card.playerId));
    if (game?.kind === 'nassau' || game?.kind === 'wolf') {
      const group = editingRound.groups.find((entry) => entry.number === game.groupNumber);
      const ids = game.kind === 'wolf' ? game.playerIds : game.sides.flatMap((side) => side.playerIds);
      if (!group || ids.some((id) => !group.playerIds.includes(id))
        || game.kind === 'wolf' && group.playerIds.length !== 4
        || game.kind === 'nassau' && (editingRound.layout.length !== 18 || editingRound.layout.some((hole) => hole.number < 1 || hole.number > 18))) {
        setMessage('Choose participants from one saved playing group. Wolf requires a foursome; Nassau requires 18 holes.');
        return;
      }
    }
    const intended = game && replaceGame(editor.base, game);
    if (!intended) {
      setMessage(editor.draft.kind === 'wolf' || editor.draft.kind === 'nassau'
        ? 'Check the game name, saved playing group, distinct participants and order. Nassau requires explicit whole USD cents for all three stakes, or choose No planned money.'
        : editor.draft.kind === 'churchy'
        ? 'Choose a complete saved foursome, order all four golfers, and enter exact whole USD cents per dot (zero or more). Only one Churchy game is allowed.'
        : editor.draft.kind === 'stroke-play' ? 'Check the game name (1–100 characters) and gross or net score basis. Net uses 100% captured Course Handicap.'
        : editor.draft.kind === 'ball-drop' || editor.draft.kind === 'skins'
        ? 'Check the game name (1–100 characters), supported format, and complete four-person Ball Drop teams. Skins are individual; net always uses 100% Course Handicap.'
        : 'Check the game name (1–100 characters), whole-number points, net allowance (1–100), and complete team assignments. Values must be safe integers within the supported points range.');
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
      {visibleGames(games, round.churchyEnabled).map((game) => <div className="round-game" key={game.id}>
        <GameResults game={game} result={round.games?.results.find((result) => result.gameId === game.id)}
          holeNumbers={round.layout.map((hole) => hole.number)} players={round.cards} />
        {canManage && <button type="button" disabled={disabled || editor !== null || !supportsRoundGame(round, game.kind ?? 'stableford')
          || round.setupLocked && (game.kind === 'nassau' || game.kind === 'wolf')} onClick={() => { open(game); }}>Edit {game.name}</button>}
        {(game.kind === 'nassau' || game.kind === 'wolf') && round.setupLocked && <p>Setup locked by saved scoring; hole choices and results are in score entry.</p>}
        {!supportsRoundGame(round, game.kind ?? 'stableford') && <p>This API does not advertise support for editing this game.</p>}
      </div>)}
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
          roster={editor.roster}
          churchyEnabled={round.churchyEnabled === true} groups={editingRound.groups}
          supportedGameKinds={round.supportedGameKinds?.filter((kind) => supportsRoundGame(editingRound, kind))}
          setupLocked={round.setupLocked || editingRound.setupLocked}
          allowChurchyCreation={!editor.base.some((game) => game.kind === 'churchy' || game.id === editor.draft.id)}
          saveDisabled={editor.conflict} cancelDisabled={working} retry={editor.attempt !== null}
          onChange={change} onSave={() => { void save(); }} onCancel={() => {
            setEditor(null);
            setMessage(editor.attempt ? 'Closing editing does not undo an earlier save. Refresh to see the saved settings.' : '');
            onDirtyChange(false);
          }} />
      </>}
      {editor?.draft.kind === 'churchy' && round.churchyEnabled !== true && <button type="button" disabled={working}
        onClick={() => { setEditor(null); onDirtyChange(false); }}>Cancel unavailable experimental edit</button>}
    </section>
  );
}
