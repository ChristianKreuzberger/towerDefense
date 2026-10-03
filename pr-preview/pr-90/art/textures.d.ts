import type Phaser from "phaser";
import { type CreatureArchetype } from "@tower-defense/shared";
export declare const SS = 2;
export declare const CREATURE_SCALE: Record<CreatureArchetype, number>;
export declare const TOWER_SCALE = 2;
export declare const KEY: {
    readonly towerBase: (player: number) => string;
    readonly turret: (player: number, tier: number) => string;
    readonly badge: (player: number) => string;
    readonly pips: (count: number) => string;
    readonly creature: (archetype: CreatureArchetype) => string;
    readonly ruin: (player: number) => string;
    readonly rut: "rut";
    readonly shadow: "fx-shadow";
    readonly soft: "fx-soft";
    readonly spark: "fx-spark";
    readonly bolt: "fx-bolt";
    readonly dot: "fx-dot";
    readonly px: "fx-px";
};
export declare function ensureTextures(scene: Phaser.Scene, cs: number): void;
//# sourceMappingURL=textures.d.ts.map