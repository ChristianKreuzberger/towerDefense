// Static title-screen diorama drawn with the same painters as the board sprites.
import type { CreatureArchetype, MapCell } from "@tower-defense/shared";

import { PLAYER_COLORS, hash3 } from "./palette";
import { paintCreature, paintTerrain, paintTowerBadge, paintTowerBase, paintTurret } from "./paint";

const COLS = 24;
const ROWS = 8;
const CELL = 40;
const SEED = 4242;

const TOWERS: Array<{ x: number; y: number; player: number; level: number; angle: number }> = [
  { x: 4, y: 2, player: 0, level: 2, angle: 0.5 },
  { x: 11, y: 5, player: 1, level: 3, angle: -0.2 },
  { x: 17, y: 2, player: 2, level: 1, angle: 0.3 },
  { x: 21, y: 5, player: 4, level: 4, angle: 2.6 }
];

const CREATURES: Array<{ x: number; y: number; archetype: CreatureArchetype; scale: number }> = [
  { x: 2.5, y: 4.5, archetype: "runner", scale: 1.05 },
  { x: 6.5, y: 3.6, archetype: "swarm", scale: 0.85 },
  { x: 7.4, y: 4.3, archetype: "swarm", scale: 0.85 },
  { x: 9.5, y: 3.5, archetype: "armored", scale: 1.15 },
  { x: 14.5, y: 3.5, archetype: "tank", scale: 1.45 }
];

export function paintHero(canvas: HTMLCanvasElement): void {
  canvas.width = COLS * CELL;
  canvas.height = ROWS * CELL;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return;
  }
  const cells: MapCell[] = [];
  for (let y = 0; y < ROWS; y += 1) {
    for (let x = 0; x < COLS; x += 1) {
      // Towers stand on grass pads beside the road, never on it (spec/05).
      const forced = TOWERS.some((tower) => tower.x === x && tower.y === y);
      const lane = y >= 3 && y <= 4;
      cells.push({ x, y, buildable: !forced && (lane || hash3(SEED, x, y) < 0.5), pathWear: 0 });
    }
  }
  paintTerrain(ctx, cells, COLS, ROWS, CELL, SEED, undefined, TOWERS.map(({ x, y }) => ({ x, y })));

  const draw = (size: number, cx: number, cy: number, angle: number, paint: (c: CanvasRenderingContext2D) => void): void => {
    const sprite = document.createElement("canvas");
    sprite.width = size * 2;
    sprite.height = size * 2;
    const spriteCtx = sprite.getContext("2d");
    if (!spriteCtx) {
      return;
    }
    paint(spriteCtx);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);
    ctx.drawImage(sprite, -size / 2, -size / 2, size, size);
    ctx.restore();
  };
  const shadow = (cx: number, cy: number, w: number, h: number): void => {
    ctx.fillStyle = "rgba(30, 28, 24, 0.28)";
    ctx.beginPath();
    ctx.ellipse(cx, cy, w / 2, h / 2, 0, 0, Math.PI * 2);
    ctx.fill();
  };

  for (const creature of CREATURES) {
    const cx = creature.x * CELL;
    const cy = creature.y * CELL;
    const size = CELL * creature.scale;
    shadow(cx, cy + CELL * 0.24, size * 0.95, size * 0.5);
    draw(size, cx, cy, 0, (c) => paintCreature(c, creature.archetype, size * 2));
  }
  for (const tower of TOWERS) {
    const cx = (tower.x + 0.5) * CELL;
    const cy = (tower.y + 0.5) * CELL;
    const size = CELL * 2;
    const color = PLAYER_COLORS[tower.player] ?? 0xffffff;
    shadow(cx, cy + CELL * 0.2, size * 1.05, CELL * 1.15);
    draw(size, cx, cy, 0, (c) => paintTowerBase(c, size * 2, color));
    draw(size, cx, cy, tower.angle, (c) => paintTurret(c, size * 2, color, tower.level));
    const badge = CELL * 0.62;
    draw(badge, cx + CELL * 0.74, cy + CELL * 0.7, 0, (c) => paintTowerBadge(c, badge * 2, String(tower.player + 1)));
  }
}
