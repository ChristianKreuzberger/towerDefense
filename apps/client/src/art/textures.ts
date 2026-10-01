// Bakes all procedural sprites into Phaser canvas textures. Runs at boot and again only if the cell size changes.
import type Phaser from "phaser";
import type { CreatureArchetype } from "@tower-defense/shared";

import { PLAYER_COLORS } from "./palette";
import {
  paintBolt,
  paintCreature,
  paintDot,
  paintRuins,
  paintPips,
  paintRut,
  paintShadow,
  paintSoftDisc,
  paintSpark,
  paintTowerBadge,
  paintTowerBase,
  paintTurret,
  paintWall
} from "./paint";

// Sprites are baked at 2x and displayed at 1/SS so they stay crisp when the board is scaled up.
export const SS = 2;
export const MAX_TOWER_LEVEL_ART = 4;
export const CREATURE_SCALE: Record<CreatureArchetype, number> = { runner: 1.05, swarm: 0.85, armored: 1.15, tank: 1.45 };
export const TOWER_SCALE = 2;

export const KEY = {
  towerBase: (player: number): string => `tower-base-${player}`,
  turret: (player: number, level: number): string => `turret-${player}-${Math.min(level, MAX_TOWER_LEVEL_ART)}`,
  ruins: (player: number): string => `ruins-${player}`,
  badge: (player: number): string => `badge-${player}`,
  pips: (count: number): string => `pips-${Math.min(Math.max(count, 1), 5)}`,
  creature: (archetype: CreatureArchetype): string => `creature-${archetype}`,
  wall: (player: number, crack: number): string => `wall-${player}-${crack}`,
  rut: "rut",
  shadow: "fx-shadow",
  soft: "fx-soft",
  spark: "fx-spark",
  bolt: "fx-bolt",
  dot: "fx-dot",
  px: "fx-px"
} as const;

const bakedFor = new WeakMap<Phaser.Textures.TextureManager, number>();

function bake(
  textures: Phaser.Textures.TextureManager,
  key: string,
  width: number,
  height: number,
  paint: (ctx: CanvasRenderingContext2D) => void
): void {
  if (textures.exists(key)) {
    textures.remove(key);
  }
  const texture = textures.createCanvas(key, Math.max(1, Math.round(width)), Math.max(1, Math.round(height)));
  if (!texture) {
    return;
  }
  paint(texture.context);
  texture.refresh();
}

export function ensureTextures(scene: Phaser.Scene, cs: number): void {
  const textures = scene.textures;
  if (bakedFor.get(textures) === cs) {
    return;
  }
  bakedFor.set(textures, cs);

  const towerPx = Math.round(cs * TOWER_SCALE * SS);
  PLAYER_COLORS.forEach((color, index) => {
    bake(textures, KEY.towerBase(index), towerPx, towerPx, (ctx) => paintTowerBase(ctx, towerPx, color));
    for (let level = 1; level <= MAX_TOWER_LEVEL_ART; level += 1) {
      bake(textures, KEY.turret(index, level), towerPx, towerPx, (ctx) => paintTurret(ctx, towerPx, color, level));
    }
    bake(textures, KEY.ruins(index), towerPx, towerPx, (ctx) => paintRuins(ctx, towerPx, color));
    const badgePx = Math.round(cs * 0.62 * SS);
    bake(textures, KEY.badge(index), badgePx, badgePx, (ctx) => paintTowerBadge(ctx, badgePx, String(index + 1)));
    for (let crack = 0; crack < 3; crack += 1) {
      const wallPx = Math.round(cs * SS);
      bake(textures, KEY.wall(index, crack), wallPx, wallPx, (ctx) => paintWall(ctx, wallPx, color, crack));
    }
  });

  for (let count = 1; count <= 5; count += 1) {
    const h = Math.round(cs * 0.22 * SS);
    const w = Math.round(h * 2.6 * count);
    bake(textures, KEY.pips(count), w, h, (ctx) => paintPips(ctx, w, h, count));
  }

  for (const archetype of Object.keys(CREATURE_SCALE) as CreatureArchetype[]) {
    const px = Math.round(cs * CREATURE_SCALE[archetype] * SS);
    bake(textures, KEY.creature(archetype), px, px, (ctx) => paintCreature(ctx, archetype, px));
  }

  const cellPx = Math.round(cs);
  bake(textures, KEY.rut, cellPx, cellPx, (ctx) => paintRut(ctx, cellPx));
  bake(textures, KEY.shadow, 64, 64, (ctx) => paintShadow(ctx, 64));
  bake(textures, KEY.soft, 32, 32, (ctx) => paintSoftDisc(ctx, 32));
  bake(textures, KEY.spark, 32, 32, (ctx) => paintSpark(ctx, 32));
  bake(textures, KEY.bolt, 48, 16, (ctx) => paintBolt(ctx, 48, 16));
  bake(textures, KEY.dot, 16, 16, (ctx) => paintDot(ctx, 16));
  bake(textures, KEY.px, 4, 4, (ctx) => {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, 4, 4);
  });
}
