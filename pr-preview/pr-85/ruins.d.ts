export interface RuinInfo {
    ownerName: string;
    wave: number;
}
export declare function describeRuin(info: RuinInfo): {
    title: string;
    detail: string;
};
export declare function ownerNameFor(players: Array<{
    id: string;
    name: string;
}>, playerId: string): string;
//# sourceMappingURL=ruins.d.ts.map