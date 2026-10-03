import type { MatchEvent, MatchSnapshot } from "@tower-defense/shared";
import type { Effects } from "../art/fx";
import type { CreatureVisual, PendingDeath, TowerVisual } from "./types";
export declare const FLASH_MS = 200;
export declare const SHAKE_MS = 220;
export declare const RECOIL_MS = 140;
export interface FxContext {
    fx: Effects | undefined;
    cellSize: number;
    lastWave: number;
    lastWaveTick: number;
    towerVisuals: Map<string, TowerVisual>;
    creatureVisuals: Map<string, CreatureVisual>;
    pendingDeaths: Map<string, PendingDeath>;
}
export declare function playEvents(ctx: FxContext, events: MatchEvent[], snapshot: MatchSnapshot, glideMs: number): void;
//# sourceMappingURL=fx-dispatch.d.ts.map