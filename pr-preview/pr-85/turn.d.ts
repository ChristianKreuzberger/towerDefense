export interface TurnPlayer {
    id: string;
    readyForWave: boolean;
    eliminated: boolean;
}
export declare function nextPendingPlayerId(players: readonly TurnPlayer[], afterId: string): string | null;
export declare function firstPendingPlayerId(players: readonly TurnPlayer[]): string | null;
//# sourceMappingURL=turn.d.ts.map