// Tooltip text for the ruins a destroyed tower leaves behind.
export interface RuinInfo {
  ownerName: string;
  wave: number;
}

export function describeRuin(info: RuinInfo): { title: string; detail: string } {
  return { title: `Ruins of ${info.ownerName}'s tower`, detail: `Destroyed in wave ${info.wave}` };
}

// Falls back to the id so a missing player record never produces an empty tooltip.
export function ownerNameFor(players: Array<{ id: string; name: string }>, playerId: string): string {
  const name = players.find((player) => player.id === playerId)?.name.trim();
  return name ? name : playerId;
}
