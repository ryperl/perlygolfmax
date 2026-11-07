import { useEffect, useMemo, useState } from 'react';
import type { ScoresClient } from '../../client/scoring';
import { SessionExpiredError } from '../../client/events';
import { PrivateRequestError } from '../../client/private-request';
import type { EventSetupInput, EventWorkspace, OverallCompetition } from '../../domain/setup';
import { isStablefordGame } from '../../domain/games';

type GameChoice = { readonly id: string; readonly name: string };
type Options = Readonly<Record<string, readonly GameChoice[]>>;

export function OverallCompetitionEditor({ workspace, draft, scores, disabled, onChange, onDenied }: {
  readonly workspace: EventWorkspace;
  readonly draft: EventSetupInput;
  readonly scores: ScoresClient | undefined;
  readonly disabled: boolean;
  readonly onChange: (value: OverallCompetition | null) => void;
  readonly onDenied: (failure: Error, expired: boolean) => void;
}) {
  const competition = draft.overallCompetition;
  const stableford = competition?.kind === 'stableford';
  const [attempt, setAttempt] = useState(0);
  const generation = useMemo(() => ({ workspace, scores, stableford, attempt }), [workspace, scores, stableford, attempt]);
  const [result, setResult] = useState<{
    readonly generation: object;
    readonly options: Options; readonly error: string;
  } | null>(null);
  const current = result?.generation === generation ? result : null;
  useEffect(() => {
    if (!stableford || !scores || workspace.event.role !== 'owner' || workspace.event.status !== 'active') return;
    const controller = new AbortController();
    const client = scores;
    const options: Record<string, readonly GameChoice[]> = {};
    let next = 0;
    async function worker() {
      while (!controller.signal.aborted) {
        const round = workspace.rounds[next++];
        if (!round) return;
        const value = await client.load(workspace.event.id, round.id, controller.signal);
        controller.signal.throwIfAborted();
        options[round.id] = value.games?.configuration.games.filter(isStablefordGame).map((game) => ({ id: game.id, name: game.name })) ?? [];
      }
    }
    void Promise.all(Array.from({ length: Math.min(3, workspace.rounds.length) }, worker)).then(() => {
      if (!controller.signal.aborted) setResult({ generation, options, error: '' });
    }).catch((failure: unknown) => {
      if (controller.signal.aborted) return;
      controller.abort();
      const error = failure instanceof Error ? failure : new Error('Saved games could not be loaded.');
      const expired = failure instanceof SessionExpiredError || failure instanceof PrivateRequestError && failure.status === 401;
      if (expired || failure instanceof PrivateRequestError && [403, 404].includes(failure.status)) {
        onDenied(error, expired);
      } else {
        setResult({ generation, options: {}, error: `${error.message} Your competition draft is preserved. Retry saved games.` });
      }
    });
    return () => { controller.abort(); };
  }, [workspace, scores, stableford, attempt, generation, onDenied]);

  return <fieldset className="panel overall-setup" disabled={disabled}>
    <legend>Optional overall event competition</legend>
    <label><input type="checkbox" checked={competition != null} onChange={(event) => {
      onChange(event.target.checked ? { kind: 'stableford', credit: 'individual', roundGames: [] } : null);
    }} />Enable overall leaderboard</label>
    <p>One competition across every event round. Round leaderboards stay separate. Save setup to apply changes.</p>
    {competition && <>
      <label>Competition<select value={competition.kind} onChange={(event) => {
        onChange(event.target.value === 'stroke-play' ? { kind: 'stroke-play', basis: 'gross' }
          : { kind: 'stableford', credit: 'individual', roundGames: [] });
      }}><option value="stableford">Stableford points</option><option value="stroke-play">Stroke play</option></select></label>
      {competition.kind === 'stroke-play' ? <>
        <label>Stroke basis<select value={competition.basis} onChange={(event) => {
          onChange(event.target.value === 'net' ? { kind: 'stroke-play', basis: 'net', handicapAllowancePercent: 95 }
            : { kind: 'stroke-play', basis: 'gross' });
        }}><option value="gross">Gross</option><option value="net">Net</option></select></label>
        {competition.basis === 'net' && <label>Net handicap allowance (%)<input type="number" min="1" max="100" step="1"
          value={Number.isFinite(competition.handicapAllowancePercent) ? competition.handicapAllowancePercent : ''} onChange={(event) => {
            onChange({ ...competition, handicapAllowancePercent: event.target.valueAsNumber });
          }} /></label>}
        <p>Live relative-to-par on completed numeric holes, lowest first. Net uses captured tee and Handicap Index inputs only.
          Pickup, X7 or DNF means no valid stroke total until corrected. Blank holes remain pending.</p>
      </> : <>
        <label>Event points credit<select value={competition.credit} onChange={(event) => {
          onChange({ ...competition, credit: event.target.value === 'team' ? 'team' : 'individual' });
        }}><option value="individual">Individual components (default for new competition)</option>
          <option value="team">Full team points to each team member</option></select></label>
        <p>Credit applies to team games. Individual games always contribute each golfer’s own points.</p>
        <p>Select one saved Stableford game per round. Ball Drop and Skins are not overall points sources. Its actual saved points rules are unchanged. No game is selected automatically.
          Missing selections or incomplete team setup leave standings pending or unavailable, never zero.</p>
        {competition.roundGames.some((binding) => !draft.rounds.some((round) => round.id === binding.roundId)) && <div>
          <p>A saved game selection refers to a round no longer in this event draft.</p>
          <button type="button" onClick={() => { onChange({ ...competition,
            roundGames: competition.roundGames.filter((binding) => draft.rounds.some((round) => round.id === binding.roundId)),
          }); }}>Remove obsolete round selections</button>
        </div>}
        {!scores ? <p>Saved-game selections are unavailable in this connection.</p>
          : !current ? <p role="status">Loading saved games… Selected games are retained.</p>
            : current.error && <p role="alert">{current.error}</p>}
        <button type="button" disabled={!scores || !current} onClick={() => { setAttempt((value) => value + 1); }}>Retry saved games</button>
        {draft.rounds.map((round, index) => {
          const saved = workspace.rounds.some((value) => value.id === round.id);
          const selected = competition.roundGames.find((binding) => binding.roundId === round.id)?.gameId ?? '';
          const games = current?.options[round.id];
          return <div key={round.id}>
            <label>Round {index + 1}: {round.name || 'Unnamed round'} game<select value={selected}
              disabled={!saved || !games} onChange={(event) => {
                const gameId = event.target.value;
                onChange({ ...competition, roundGames: [
                  ...competition.roundGames.filter((binding) => binding.roundId !== round.id),
                  ...(gameId ? [{ roundId: round.id, gameId }] : []),
                ] });
              }}>
              <option value="">Not selected — pending</option>
              {selected && !games?.some((game) => game.id === selected) && <option value={selected}>
                {games ? 'Selected game missing — choose a saved game' : 'Saved selection — awaiting game names'}
              </option>}
              {games?.map((game) => <option key={game.id} value={game.id}>{game.name}</option>)}
            </select></label>
            {!saved && <p>Save this new round, then add a round game before selecting it here.</p>}
            {saved && games?.length === 0 && <p>No saved games. Add a game in this round’s scorecards first.</p>}
          </div>;
        })}
      </>}
    </>}
  </fieldset>;
}
