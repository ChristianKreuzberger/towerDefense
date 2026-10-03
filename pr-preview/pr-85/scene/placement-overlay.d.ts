import Phaser from "phaser";
import type { MapCell, MatchSnapshot } from "@tower-defense/shared";
import type { PlacementContext, RuinVisual, TowerVisual } from "./types";
export interface OverlayState {
    placementContext: PlacementContext | undefined;
    cellsByKey: Map<string, MapCell>;
    spawn: MatchSnapshot["map"]["spawn"];
    occupiedCells: Set<string>;
    towerSpotKeys: Set<string>;
    hoverX: number | null;
    hoverY: number | null;
    hoverTowerId: string | null;
    hoverRuinId: string | null;
    hoverGraphics?: Phaser.GameObjects.Graphics;
    ghostBase?: Phaser.GameObjects.Image;
    ghostTurret?: Phaser.GameObjects.Image;
    tooltip?: HTMLElement;
}
export interface OverlayEnv {
    towerVisuals: Map<string, TowerVisual>;
    ruinVisuals: Map<string, RuinVisual>;
    getCanvas(): HTMLCanvasElement;
    cellSize: number;
}
export declare function isHoverValid(s: OverlayState, x: number, y: number): boolean;
export declare function drawHoverAndGhost(s: OverlayState, env: OverlayEnv): void;
//# sourceMappingURL=placement-overlay.d.ts.map