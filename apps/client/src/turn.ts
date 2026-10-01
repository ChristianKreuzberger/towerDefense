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

// After a wave every ready flag is cleared, so the round restarts with the first seat that can still act.
export function firstPendingPlayerId(players: readonly TurnPlayer[]): string | null {
  return players.find((player) => !player.readyForWave && !player.eliminated)?.id ?? null;
}
