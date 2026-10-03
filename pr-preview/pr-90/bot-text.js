import { MAX_PLAYERS, MAX_PLAYER_NAME_LENGTH } from "@tower-defense/shared";
// Pure helpers for AI players (no DOM), so the menu and the pacing logic can be unit tested.
export function botName(botNumber) {
    return `Bot ${botNumber}`;
}
// Total players stay within 1..MAX_PLAYERS; when the two counts together are too many, the bots give way.
export function clampPlayerCounts(humans, bots) {
    const safeHumans = Math.max(0, Math.min(MAX_PLAYERS, Math.floor(humans) || 0));
    const safeBots = Math.max(0, Math.min(MAX_PLAYERS - safeHumans, Math.floor(bots) || 0));
    return safeHumans + safeBots === 0 ? { humans: 0, bots: 1 } : { humans: safeHumans, bots: safeBots };
}
// Humans take the first ids, bots the ones after them (p{n}), the same order the menu shows.
export function seatsToSetupPlayers(seats) {
    let botCount = 0;
    return seats.map((seat, index) => {
        const id = `p${index + 1}`;
        if (seat.kind === "bot") {
            botCount += 1;
            return { id, name: botName(botCount), ai: seat.ai };
        }
        const name = seat.name.trim().slice(0, MAX_PLAYER_NAME_LENGTH);
        return { id, name: name.length > 0 ? name : seat.defaultName };
    });
}
// Rematch: same names, ids and bot difficulties.
export function snapshotToSetupPlayers(players) {
    return players.map((player) => (player.ai ? { id: player.id, name: player.name, ai: player.ai } : { id: player.id, name: player.name }));
}
// Mirrors the host rule: bots act after every living human placed, and only while a bot still has to ready up.
export function botsCanAct(snapshot) {
    if (!snapshot || snapshot.phase !== "placement") {
        return false;
    }
    const humansPlaced = snapshot.players.every((player) => player.ai || player.eliminated || player.hasPlacedTower);
    return humansPlaced && snapshot.players.some((player) => player.ai && !player.eliminated && !player.readyForWave);
}
export function describeBotAction(name, command) {
    switch (command.type) {
        case "place-tower":
            return `${name} placed a tower`;
        case "move-tower":
            return `${name} moved its tower`;
        case "upgrade-tower":
            return `${name} upgraded ${command.track}`;
        case "set-damage-type":
            return `${name} switched to ${command.damageType} damage`;
        case "set-target-mode":
            return `${name} targets ${command.mode}`;
        case "ready-for-wave":
            return `${name} is ready`;
        default:
            return `${name} acted`;
    }
}
