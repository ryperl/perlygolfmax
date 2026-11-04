import { useEffect, useRef, useState } from 'react';
import { EventChangedError } from '../../client/events';
import type { RoundGameDefinition } from '../../domain/games';
import { maximumGamesPerRound, sameGameDefinitions } from '../../domain/games';
import type { GameWriteResult, RoundScores } from '../../domain/scoring';
import type { GameDraft } from './game-draft';
import { buildGame, draftFromGame, newGameDraft, replaceGame } from './game-draft';
import { GameResults } from './GameResults';
import { GameSettings } from './GameSettings';
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
}

export function RoundGamesPanel({ round, busy, onDirtyChange, onSave, onRefresh }: RoundGamesPanelProps) {
  const [editor, setEditor] = useState<Editor | null>(null);
  const [message, setMessage] = useState('');
  const [working, setWorking] = useState(false);
  const inFlight = useRef(false);
  const dirtyCallback = useRef(onDirtyChange);
  const games = round.games?.configuration.games ?? [];
  const archived = round.eventStatus === 'archived';
  const disabled = busy || working || archived;

  useEffect(() => { dirtyCallback.current = onDirtyChange; }, [onDirtyChange]);
  useEffect(() => () => { dirtyCallback.current(false); }, []);

  function open(game?: RoundGameDefinition) {
    if (disabled || editor) return;
    const draft = game ? draftFromGame(game) : newGameDraft();
    onDirtyChange(true);
    setMessage('');
    setEditor({
      draft, base: games, etag: round.games?.configuration.etag ?? null,
      attempt: null, conflict: false, latest: null,
    });
  }

  function change(draft: GameDraft) {
    if (!editor || disabled) return;
    setEditor({ ...editor, draft, attempt: null });
    if (!editor.conflict) setMessage('');
  }

  async function save() {
    if (!editor || disabled || editor.conflict || inFlight.current) return;
    const game = buildGame(editor.draft);
    const intended = game && replaceGame(editor.base, game);
    if (!intended) {
      setMessage('Check the game name (1–100 characters), whole-number points, and net allowance (1–100). Values must be safe integers within the supported points range.');
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
    if (!editor?.latest || disabled || editor.latest.eventStatus === 'archived') return;
    setEditor({
      ...editor, base: editor.latest.games?.configuration.games ?? [],
      etag: editor.latest.games?.configuration.etag ?? null, attempt: null, conflict: false, latest: null,
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
        <p className="game-hint">{round.courseName} · {round.teeName} / {round.teeCategory}</p>
      </header>
      {archived && <p>This trip is archived. Game settings are read-only.</p>}
      {games.length === 0 && <p>No games configured for this round.</p>}
      {games.map((game) => <div className="round-game" key={game.id}>
        <GameResults game={game} result={round.games?.results.find((result) => result.gameId === game.id)}
          holeNumbers={round.layout.map((hole) => hole.number)} />
        <button type="button" disabled={disabled || editor !== null} onClick={() => { open(game); }}>Edit {game.name}</button>
      </div>)}
      {!editor && !archived && <button type="button" disabled={disabled || games.length >= maximumGamesPerRound}
        onClick={() => { open(); }}>Add game</button>}
      {games.length >= maximumGamesPerRound && <p>This round has reached the 16-game limit.</p>}
      {message && <p role="status" className="game-notice">{message}</p>}
      {editor && <>
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
          saveDisabled={editor.conflict} cancelDisabled={working} retry={editor.attempt !== null}
          onChange={change} onSave={() => { void save(); }} onCancel={() => {
            setEditor(null);
            setMessage(editor.attempt ? 'Closing editing does not undo an earlier save. Refresh to see the saved settings.' : '');
            onDirtyChange(false);
          }} />
      </>}
    </section>
  );
}
