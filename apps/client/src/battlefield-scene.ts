import Phaser from "phaser";

import type { Creature, CreatureArchetype, MatchSnapshot, Tower, Wall } from "@tower-defense/shared";

const COLOR_BUILDABLE = 0x3f6b3a;
const COLOR_PATH = 0xc9a870;
const COLOR_PATH_WORN = 0x9d8058;
const COLOR_BLOCKED = 0x22201d;

// Mirrors --p1..--p8 CSS custom properties in apps/client/src/style.css.
const PLAYER_COLORS: number[] = [0xd85f40, 0x3f8ecf, 0xd6ab3d, 0x7c64da, 0x2caa74, 0xb76de1, 0x1f7092, 0xa95a39];
const COLOR_WALL = 0x6b4a2a;
const COLOR_CREATURE = 0x1a1a1a;

const CREATURE_GLYPH: Record<CreatureArchetype, string> = {
  runner: "R",
  swarm: "S",
  armored: "A",
  tank: "T"
};

const DEPTH_TERRAIN = 0;
const DEPTH_WALLS = 1;
const DEPTH_TOWERS = 2;
const DEPTH_CREATURES = 3;

function cellSizeForWidth(width: number): number {
  if (width > 40) {
    return 12;
  }
  if (width > 24) {
    return 16;
  }
  return 24;
}

function colorForPlayer(playerId: string): number {
  const index = Number(playerId.replace(/\D+/g, "")) - 1;
  const clamped = Math.max(0, Math.min(PLAYER_COLORS.length - 1, index));
  return PLAYER_COLORS[clamped] ?? 0xd85f40;
}

function cellCenter(x: number, y: number, cellSize: number): { cx: number; cy: number } {
  return { cx: x * cellSize + cellSize / 2, cy: y * cellSize + cellSize / 2 };
}

class BattlefieldScene extends Phaser.Scene {
  private terrain?: Phaser.GameObjects.Graphics;
  private wallsGraphics?: Phaser.GameObjects.Graphics;
  private towersGraphics?: Phaser.GameObjects.Graphics;
  private creaturesGraphics?: Phaser.GameObjects.Graphics;
  private towerLabels?: Phaser.GameObjects.Container;
  private creatureLabels?: Phaser.GameObjects.Container;
  private pendingSnapshot: MatchSnapshot | null = null;

  constructor() {
    super("battlefield");
  }

  create(): void {
    this.terrain = this.add.graphics().setDepth(DEPTH_TERRAIN);
    this.wallsGraphics = this.add.graphics().setDepth(DEPTH_WALLS);
    this.towersGraphics = this.add.graphics().setDepth(DEPTH_TOWERS);
    this.towerLabels = this.add.container(0, 0).setDepth(DEPTH_TOWERS);
    this.creaturesGraphics = this.add.graphics().setDepth(DEPTH_CREATURES);
    this.creatureLabels = this.add.container(0, 0).setDepth(DEPTH_CREATURES);
    if (this.pendingSnapshot !== null) {
      this.draw(this.pendingSnapshot);
    }
  }

  renderSnapshot(snapshot: MatchSnapshot | null): void {
    if (!this.terrain) {
      this.pendingSnapshot = snapshot;
      return;
    }
    this.draw(snapshot);
  }

  private draw(snapshot: MatchSnapshot | null): void {
    const graphics = this.terrain;
    if (!graphics) {
      return;
    }
    graphics.clear();
    this.wallsGraphics?.clear();
    this.towersGraphics?.clear();
    this.towerLabels?.removeAll(true);
    this.creaturesGraphics?.clear();
    this.creatureLabels?.removeAll(true);

    if (!snapshot) {
      return;
    }

    const { width, height, cells } = snapshot.map;
    const cellSize = cellSizeForWidth(width);
    const cellsByKey = new Map<string, MatchSnapshot["map"]["cells"][number]>();
    for (const cell of cells) {
      cellsByKey.set(`${cell.x},${cell.y}`, cell);
    }

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const cell = cellsByKey.get(`${x},${y}`);
        let color = COLOR_BLOCKED;
        if (cell) {
          if (cell.buildable) {
            color = COLOR_BUILDABLE;
          } else {
            color = cell.pathWear > 0 ? COLOR_PATH_WORN : COLOR_PATH;
          }
        }
        graphics.fillStyle(color, 1);
        graphics.fillRect(x * cellSize, y * cellSize, cellSize, cellSize);
      }
    }

    this.drawWalls(snapshot.walls, cellSize);
    this.drawTowers(snapshot.towers, cellSize);
    this.drawCreatures(snapshot.creatures, cellSize);

    const game = this.game;
    game.scale.resize(width * cellSize, height * cellSize);
  }

  private drawWalls(walls: Wall[], cellSize: number): void {
    const graphics = this.wallsGraphics;
    if (!graphics) {
      return;
    }
    const wallWidth = cellSize * 0.75;
    const wallHeight = cellSize * 0.375;
    for (const wall of walls) {
      const { cx, cy } = cellCenter(wall.x, wall.y, cellSize);
      graphics.fillStyle(COLOR_WALL, 1);
      graphics.fillRect(cx - wallWidth / 2, cy - wallHeight / 2, wallWidth, wallHeight);
    }
  }

  private drawTowers(towers: Tower[], cellSize: number): void {
    const graphics = this.towersGraphics;
    const labels = this.towerLabels;
    if (!graphics || !labels) {
      return;
    }
    const radius = cellSize * 0.4;
    for (const tower of towers) {
      const { cx, cy } = cellCenter(tower.x, tower.y, cellSize);
      const color = colorForPlayer(tower.playerId);

      if (tower.level >= 2) {
        const glowAlpha = tower.level >= 3 ? 0.35 : 0.22;
        const glowRadius = radius * (tower.level >= 3 ? 1.7 : 1.4);
        graphics.fillStyle(color, glowAlpha);
        graphics.fillCircle(cx, cy, glowRadius);
      }

      graphics.fillStyle(color, 1);
      graphics.fillCircle(cx, cy, radius);

      const text = this.add.text(cx, cy, `T${tower.level}`, {
        fontSize: `${Math.max(8, Math.floor(cellSize * 0.4))}px`,
        color: "#ffffff"
      });
      text.setOrigin(0.5, 0.5);
      labels.add(text);
    }
  }

  private drawCreatures(creatures: Creature[], cellSize: number): void {
    const graphics = this.creaturesGraphics;
    const labels = this.creatureLabels;
    if (!graphics || !labels) {
      return;
    }
    const radius = cellSize * 0.3;

    const creaturesByCell = new Map<string, Creature[]>();
    for (const creature of creatures) {
      const key = `${creature.x},${creature.y}`;
      const list = creaturesByCell.get(key) ?? [];
      list.push(creature);
      creaturesByCell.set(key, list);
    }

    for (const stack of creaturesByCell.values()) {
      const first = stack[0];
      if (!first) {
        continue;
      }
      const { cx, cy } = cellCenter(first.x, first.y, cellSize);

      graphics.fillStyle(COLOR_CREATURE, 1);
      graphics.fillCircle(cx, cy, radius);

      const glyphText = this.add.text(cx, cy, CREATURE_GLYPH[first.archetype], {
        fontSize: `${Math.max(8, Math.floor(cellSize * 0.35))}px`,
        color: "#ffffff"
      });
      glyphText.setOrigin(0.5, 0.5);
      labels.add(glyphText);

      if (stack.length > 1) {
        const badgeText = this.add.text(cx + radius * 0.8, cy - radius * 0.8, `+${stack.length - 1}`, {
          fontSize: `${Math.max(7, Math.floor(cellSize * 0.28))}px`,
          color: "#ffdd88"
        });
        badgeText.setOrigin(0.5, 0.5);
        labels.add(badgeText);
      }
    }
  }
}

export interface BattlefieldMount {
  renderMap(snapshot: MatchSnapshot | null): void;
  destroy(): void;
}

export function createBattlefieldMount(container: HTMLElement): BattlefieldMount {
  let scene: BattlefieldScene | undefined;

  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: container,
    transparent: true,
    width: 1,
    height: 1,
    scene: []
  });

  scene = new BattlefieldScene();
  game.scene.add("battlefield", scene, true);

  return {
    renderMap(snapshot: MatchSnapshot | null): void {
      scene?.renderSnapshot(snapshot);
    },
    destroy(): void {
      game.destroy(true);
    }
  };
}
