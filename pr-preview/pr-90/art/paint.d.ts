import { type CreatureArchetype, type MapCell } from "@tower-defense/shared";
type Ctx = CanvasRenderingContext2D;
export declare function paintTerrain(ctx: Ctx, cells: MapCell[], width: number, height: number, cs: number, seed: number, spawn?: {
    x: number;
    y: number;
}, towerSpots?: Array<{
    x: number;
    y: number;
}>): void;
export declare function paintRut(ctx: Ctx, cs: number): void;
export declare function paintTowerBase(ctx: Ctx, s: number, color: number): void;
export declare function paintTurret(ctx: Ctx, s: number, color: number, level: number): void;
export declare function paintTowerBadge(ctx: Ctx, s: number, label: string): void;
export declare function paintPips(ctx: Ctx, w: number, h: number, count: number): void;
export declare function paintCreature(ctx: Ctx, archetype: CreatureArchetype, s: number): void;
export declare function paintSoftDisc(ctx: Ctx, s: number): void;
export declare function paintShadow(ctx: Ctx, s: number): void;
export declare function paintSpark(ctx: Ctx, s: number): void;
export declare function paintBolt(ctx: Ctx, w: number, h: number): void;
export declare function paintDot(ctx: Ctx, s: number): void;
export declare function paintRuin(ctx: Ctx, s: number, color: number): void;
export {};
//# sourceMappingURL=paint.d.ts.map