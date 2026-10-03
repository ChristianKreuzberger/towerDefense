export function describeRuin(info) {
    return { title: `Ruins of ${info.ownerName}'s tower`, detail: `Destroyed in wave ${info.wave}` };
}
// Falls back to the id so a missing player record never produces an empty tooltip.
export function ownerNameFor(players, playerId) {
    const name = players.find((player) => player.id === playerId)?.name.trim();
    return name ? name : playerId;
}
