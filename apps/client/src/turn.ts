export interface TurnPlayer {
  id: string;
  readyForWave: boolean;
  eliminated: boolean;
}

// Hot-seat order: the next player after `afterId` (wrapping around) who still has to ready up.
export function nextPendingPlayerId(players: readonly TurnPlayer[], afterId: string): string | null {
  const start = players.findIndex((player) => player.id === afterId);
  for (let offset = 1; offset <= players.length; offset += 1) {
    const candidate = players[(start + offset + players.length) % players.length];
    if (candidate && !candidate.readyForWave && !candidate.eliminated) {
      return candidate.id;
    }
  }
  return null;
}
