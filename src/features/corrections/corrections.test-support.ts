import type { RoundCorrectionReadModel, RoundCorrectionWriteRequest, RoundCorrectionWriteResult } from '../../domain/round-corrections';
import { purseTestContext, purseTestId } from '../../domain/purse.test-support';

export function fictionalCorrection(): RoundCorrectionReadModel {
  const f = purseTestContext(4, 'two-net-aggregate');
  const round = f.workspace.rounds[0];
  const game = f.rounds[0]?.games?.configuration.games[0];
  if (!round || !game || !('teams' in game)) throw new Error('Missing fictional correction source');
  return {
    eventId: f.workspace.event.id, roundId: round.id, eventEtag: 'fictional-event', roundEtag: 'fictional-round',
    gamesEtag: 'fictional-games', allowPerGolferTees: true,
    teeProfileId: round.teeProfile.id, compatibleTees: [round.teeProfile, { ...round.teeProfile, id: 701, name: 'Fictional second tee' }],
    players: round.players.map((player) => ({ ...player, handicapIndex: player.handicapIndex ?? null })),
    playerTeeSelections: [], groups: round.groups, gameTeams: [{ gameId: game.id, teams: game.teams }], warnings: [],
  };
}
export function fictionalCorrectionResult(model: RoundCorrectionReadModel, input: RoundCorrectionWriteRequest): RoundCorrectionWriteResult {
  return { applied: true, model: { ...model, eventEtag: 'fictional-next-event', roundEtag: 'fictional-next-round',
    inputRevision: 'a'.repeat(64), teeProfileId: input.correction.teeProfileId,
    playerTeeSelections: input.correction.playerTeeSelections ?? [], groups: input.correction.groups,
    gameTeams: input.correction.gameTeams ?? [],
    players: model.players.map((player, index) => {
      const value = input.correction.players.find((entry) => entry.playerId === player.playerId)?.handicapIndexValue;
      return { ...player, handicapIndex: value === null ? null : value === undefined || !player.handicapIndex ? player.handicapIndex
        : { ...player.handicapIndex, id: purseTestId(8000 + index), value, source: 'Fictional organizer correction',
          previousObservationId: player.handicapIndex.id } };
    }),
  } };
}
