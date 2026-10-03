import type { MapCell, MatchEvent, MatchSnapshot } from "@tower-defense/shared";
import type { WireSnapshot } from "@tower-defense/transport/wire-types";
import type { MapCache } from "./state";
export declare function mapKeyOf(map: {
    seed: number;
    width: number;
    height: number;
}): string;
export declare function resetMatchCaches(): void;
export declare function buildMapCache(key: string, cells: MapCell[], towerSpotList: Array<{
    x: number;
    y: number;
}>): MapCache;
export declare function hydrateSnapshot(wire: WireSnapshot): {
    snapshot: MatchSnapshot;
    newEvents: MatchEvent[];
} | null;
//# sourceMappingURL=hydrate.d.ts.map