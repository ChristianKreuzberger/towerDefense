import { type AiDifficulty, type MatchSetup, type MatchSnapshot, type SimulationCommand } from "@tower-defense/shared";
export declare function botName(botNumber: number): string;
export declare function clampPlayerCounts(humans: number, bots: number): {
    humans: number;
    bots: number;
};
export type MenuSeat = {
    kind: "human";
    name: string;
    defaultName: string;
} | {
    kind: "bot";
    ai: AiDifficulty;
};
export declare function seatsToSetupPlayers(seats: readonly MenuSeat[]): MatchSetup["players"];
export declare function snapshotToSetupPlayers(players: MatchSnapshot["players"]): MatchSetup["players"];
export declare function botsCanAct(snapshot: MatchSnapshot | null): boolean;
export declare function describeBotAction(name: string, command: SimulationCommand): string;
//# sourceMappingURL=bot-text.d.ts.map