import type { MatchEvent, MatchSnapshot } from "@tower-defense/shared";
import type { PlayerChipRefs } from "./state";
export declare function setChipSelectHandler(handler: (playerId: string) => void): void;
export declare function pickDefaultPlayer(snapshot: MatchSnapshot | null): string;
export declare function updatePlayerOptions(snapshot: MatchSnapshot | null): void;
export declare function buildPlayerChip(player: MatchSnapshot["players"][number], towerId: string | null): PlayerChipRefs;
export declare function renderPlayerCards(snapshot: MatchSnapshot | null, newEvents?: MatchEvent[]): void;
//# sourceMappingURL=scoreboard.d.ts.map