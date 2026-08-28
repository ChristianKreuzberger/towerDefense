import Phaser from "phaser";

import type { MatchSnapshot } from "@tower-defense/shared";

const COLOR_BUILDABLE = 0x3f6b3a;
const COLOR_PATH = 0xc9a870;
const COLOR_PATH_WORN = 0x9d8058;
const COLOR_BLOCKED = 0x22201d;

function cellSizeForWidth(width: number): number {
  if (width > 40) {
    return 12;
  }
  if (width > 24) {
    return 16;
  }
  return 24;
}

class BattlefieldScene extends Phaser.Scene {
  private terrain?: Phaser.GameObjects.Graphics;
  private pendingSnapshot: MatchSnapshot | null = null;

  constructor() {
    super("battlefield");
  }

  create(): void {
    this.terrain = this.add.graphics();
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

    const game = this.game;
    game.scale.resize(width * cellSize, height * cellSize);
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
