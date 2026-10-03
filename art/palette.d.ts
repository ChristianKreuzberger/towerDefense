export declare const PLAYER_COLORS: readonly number[];
export declare const INK = 2762032;
export declare const CREAM = 15985366;
export declare const TERRAIN: {
    road: number;
    roadSpeck: number;
    roadGrid: number;
    rut: number;
    grass: readonly number[];
    grassBlade: number;
    grassEdge: number;
    spot: number;
    flower: readonly number[];
    shadow: number;
};
export declare const ENEMY: {
    runner: {
        body: number;
        accent: number;
    };
    swarm: {
        body: number;
        accent: number;
    };
    armored: {
        body: number;
        accent: number;
    };
    tank: {
        body: number;
        accent: number;
    };
};
export declare const UI_COLORS: {
    hover: number;
    invalid: number;
    cursor: number;
    gold: number;
    good: number;
    bad: number;
};
export declare function playerIndex(playerId: string): number;
export declare function colorForPlayer(playerId: string): number;
export declare function hex(color: number): string;
export declare function shade(color: number, factor: number): number;
export declare function applyPaletteCssVars(root?: HTMLElement): void;
export declare function hash3(seed: number, x: number, y: number): number;
//# sourceMappingURL=palette.d.ts.map