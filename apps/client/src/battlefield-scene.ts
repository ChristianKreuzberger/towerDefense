import Phaser from "phaser";

import type { Creature, CreatureArchetype, MatchPhase, MatchSnapshot, Tower, Wall } from "@tower-defense/shared";

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
const DEPTH_CURSOR = 4;
const DEPTH_HOVER = 5;
const DEPTH_FLASH = 6;

const COLOR_CURSOR = 0xfff4a7;
const COLOR_HOVER = 0x8be9fd;
const COLOR_INVALID_FLASH = 0xff4d4d;

const POP_DURATION_MS = 220;

export function cellSizeForWidth(width: number): number {
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

export interface PlacementContext {
  phase: MatchPhase;
  playerId: string;
  hasTowerAlready: boolean;
}

interface TowerVisual {
  container: Phaser.GameObjects.Container;
  arc: Phaser.GameObjects.Arc;
  glow: Phaser.GameObjects.Arc | undefined;
  label: Phaser.GameObjects.Text;
}

class BattlefieldScene extends Phaser.Scene {
  private terrain?: Phaser.GameObjects.Graphics;
  private wallsGraphics?: Phaser.GameObjects.Graphics;
  private creaturesGraphics?: Phaser.GameObjects.Graphics;
  private creatureLabels?: Phaser.GameObjects.Container;
  private cursorGraphics?: Phaser.GameObjects.Graphics;
  private hoverGraphics?: Phaser.GameObjects.Graphics;
  private ghostGraphics?: Phaser.GameObjects.Graphics;
  private towerVisuals = new Map<string, TowerVisual>();
  private hasRenderedTowersOnce = false;
  private pendingSnapshot: MatchSnapshot | null = null;
  private cellSize = 24;
  private cursorX: number | null = null;
  private cursorY: number | null = null;
  private pendingCursor: { x: number; y: number } | null = null;
  private onCellClick: ((x: number, y: number) => void) | undefined;
  private placementContext: PlacementContext | undefined;
  private cellsByKey = new Map<string, MatchSnapshot["map"]["cells"][number]>();
  private occupiedCells = new Set<string>();
  private hoverX: number | null = null;
  private hoverY: number | null = null;
  private reducedMotion = false;

  constructor() {
    super("battlefield");
  }

  create(): void {
    this.reducedMotion = typeof window !== "undefined"
      && typeof window.matchMedia === "function"
      && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    this.terrain = this.add.graphics().setDepth(DEPTH_TERRAIN);
    this.wallsGraphics = this.add.graphics().setDepth(DEPTH_WALLS);
    this.creaturesGraphics = this.add.graphics().setDepth(DEPTH_CREATURES);
    this.creatureLabels = this.add.container(0, 0).setDepth(DEPTH_CREATURES);
    this.cursorGraphics = this.add.graphics().setDepth(DEPTH_CURSOR);
    this.hoverGraphics = this.add.graphics().setDepth(DEPTH_HOVER);
    this.ghostGraphics = this.add.graphics().setDepth(DEPTH_HOVER);
    this.input.on("pointerdown", this.handlePointerDown, this);
    this.input.on("pointermove", this.handlePointerMove, this);
    this.game.canvas.addEventListener("pointerleave", this.handlePointerLeave);
    if (this.pendingCursor !== null) {
      this.cursorX = this.pendingCursor.x;
      this.cursorY = this.pendingCursor.y;
      this.pendingCursor = null;
    }
    if (this.pendingSnapshot !== null) {
      this.draw(this.pendingSnapshot);
    } else {
      this.drawCursor();
    }
  }

  renderSnapshot(snapshot: MatchSnapshot | null): void {
    if (!this.terrain) {
      this.pendingSnapshot = snapshot;
      return;
    }
    this.draw(snapshot);
  }

  setOnCellClick(callback: ((x: number, y: number) => void) | undefined): void {
    this.onCellClick = callback;
  }

  setCursor(x: number, y: number): void {
    if (!this.cursorGraphics) {
      this.pendingCursor = { x, y };
      return;
    }
    this.cursorX = x;
    this.cursorY = y;
    this.drawCursor();
  }

  setPlacementContext(context: PlacementContext): void {
    this.placementContext = context;
    this.drawHoverAndGhost();
  }

  private handlePointerDown(pointer: Phaser.Input.Pointer): void {
    const x = Math.floor(pointer.x / this.cellSize);
    const y = Math.floor(pointer.y / this.cellSize);
    if (!this.isHoverValid(x, y)) {
      this.playInvalidClickFlash(x, y);
    }
    if (this.onCellClick) {
      this.onCellClick(x, y);
    }
  }

  private handlePointerMove = (pointer: Phaser.Input.Pointer): void => {
    const x = Math.floor(pointer.x / this.cellSize);
    const y = Math.floor(pointer.y / this.cellSize);
    this.hoverX = x;
    this.hoverY = y;
    this.drawHoverAndGhost();
  };

  private handlePointerLeave = (): void => {
    this.hoverX = null;
    this.hoverY = null;
    this.drawHoverAndGhost();
  };

  private isHoverValid(x: number, y: number): boolean {
    if (!this.placementContext || this.placementContext.phase !== "placement") {
      return false;
    }
    const cell = this.cellsByKey.get(`${x},${y}`);
    if (!cell || !cell.buildable) {
      return false;
    }
    return !this.occupiedCells.has(`${x},${y}`);
  }

  private isGhostValid(x: number, y: number): boolean {
    if (!this.placementContext || this.placementContext.hasTowerAlready) {
      return false;
    }
    return this.isHoverValid(x, y);
  }

  private drawHoverAndGhost(): void {
    const hoverGraphics = this.hoverGraphics;
    const ghostGraphics = this.ghostGraphics;
    if (!hoverGraphics || !ghostGraphics) {
      return;
    }
    hoverGraphics.clear();
    ghostGraphics.clear();

    if (this.hoverX === null || this.hoverY === null) {
      return;
    }
    const x = this.hoverX;
    const y = this.hoverY;
    if (!this.isHoverValid(x, y)) {
      return;
    }

    const cellSize = this.cellSize;
    hoverGraphics.fillStyle(COLOR_HOVER, 0.18);
    hoverGraphics.fillRect(x * cellSize, y * cellSize, cellSize, cellSize);
    hoverGraphics.lineStyle(2, COLOR_HOVER, 0.85);
    hoverGraphics.strokeRect(x * cellSize + 1, y * cellSize + 1, cellSize - 2, cellSize - 2);

    if (this.isGhostValid(x, y) && this.placementContext) {
      const { cx, cy } = cellCenter(x, y, cellSize);
      const radius = cellSize * 0.4;
      const color = colorForPlayer(this.placementContext.playerId);
      ghostGraphics.fillStyle(color, 0.45);
      ghostGraphics.fillCircle(cx, cy, radius);
    }
  }

  private playInvalidClickFlash(x: number, y: number): void {
    const cellSize = this.cellSize;
    const { cx, cy } = cellCenter(x, y, cellSize);
    const rect = this.add
      .rectangle(cx, cy, cellSize, cellSize, COLOR_INVALID_FLASH, 0.4)
      .setDepth(DEPTH_FLASH);

    if (this.reducedMotion) {
      this.time.delayedCall(120, () => rect.destroy());
      return;
    }

    this.tweens.add({
      targets: rect,
      x: { from: cx - 4, to: cx + 4 },
      duration: 40,
      yoyo: true,
      repeat: 4
    });
    this.tweens.add({
      targets: rect,
      alpha: 0,
      duration: 260,
      onComplete: () => rect.destroy()
    });
  }

  private drawCursor(): void {
    const graphics = this.cursorGraphics;
    if (!graphics) {
      return;
    }
    graphics.clear();
    if (this.cursorX === null || this.cursorY === null) {
      return;
    }
    const cellSize = this.cellSize;
    const x = this.cursorX * cellSize;
    const y = this.cursorY * cellSize;
    graphics.lineStyle(2, COLOR_CURSOR, 0.92);
    graphics.strokeRect(x + 1, y + 1, cellSize - 2, cellSize - 2);
  }

  private draw(snapshot: MatchSnapshot | null): void {
    const graphics = this.terrain;
    if (!graphics) {
      return;
    }
    graphics.clear();
    this.wallsGraphics?.clear();
    this.creaturesGraphics?.clear();
    this.creatureLabels?.removeAll(true);

    if (!snapshot) {
      this.cellsByKey = new Map();
      this.occupiedCells = new Set();
      for (const visual of this.towerVisuals.values()) {
        visual.container.destroy();
      }
      this.towerVisuals.clear();
      this.drawCursor();
      this.drawHoverAndGhost();
      return;
    }

    const { width, height, cells } = snapshot.map;
    const cellSize = cellSizeForWidth(width);
    this.cellSize = cellSize;
    const cellsByKey = new Map<string, MatchSnapshot["map"]["cells"][number]>();
    for (const cell of cells) {
      cellsByKey.set(`${cell.x},${cell.y}`, cell);
    }
    this.cellsByKey = cellsByKey;

    const occupiedCells = new Set<string>();
    for (const tower of snapshot.towers) {
      occupiedCells.add(`${tower.x},${tower.y}`);
    }
    for (const wall of snapshot.walls) {
      occupiedCells.add(`${wall.x},${wall.y}`);
    }
    this.occupiedCells = occupiedCells;

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
    this.drawCursor();
    this.drawHoverAndGhost();

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
    const seen = new Set<string>();
    const radius = cellSize * 0.4;

    const skipPopAnimation = !this.hasRenderedTowersOnce;

    for (const tower of towers) {
      seen.add(tower.id);
      let visual = this.towerVisuals.get(tower.id);
      const isNew = !visual;
      if (!visual) {
        visual = this.createTowerVisual(tower, cellSize);
        this.towerVisuals.set(tower.id, visual);
      }
      this.updateTowerVisual(visual, tower, cellSize, radius);
      if (isNew) {
        if (skipPopAnimation) {
          visual.container.setScale(1);
        } else {
          this.playTowerPopAnimation(visual.container);
        }
      }
    }

    for (const [id, visual] of this.towerVisuals) {
      if (!seen.has(id)) {
        visual.container.destroy();
        this.towerVisuals.delete(id);
      }
    }

    this.hasRenderedTowersOnce = true;
  }

  private createTowerVisual(tower: Tower, cellSize: number): TowerVisual {
    const { cx, cy } = cellCenter(tower.x, tower.y, cellSize);
    const color = colorForPlayer(tower.playerId);
    const container = this.add.container(cx, cy).setDepth(DEPTH_TOWERS);

    const glow = this.add.circle(0, 0, 1, color, 0);
    const arc = this.add.circle(0, 0, cellSize * 0.4, color, 1);
    const label = this.add.text(0, 0, "", {
      fontSize: `${Math.max(8, Math.floor(cellSize * 0.4))}px`,
      color: "#ffffff"
    });
    label.setOrigin(0.5, 0.5);

    container.add([glow, arc, label]);
    return { container, arc, glow, label };
  }

  private updateTowerVisual(visual: TowerVisual, tower: Tower, cellSize: number, radius: number): void {
    const { cx, cy } = cellCenter(tower.x, tower.y, cellSize);
    const color = colorForPlayer(tower.playerId);
    visual.container.setPosition(cx, cy);

    visual.arc.setRadius(radius);
    visual.arc.setFillStyle(color, 1);

    if (tower.level >= 2 && visual.glow) {
      const glowAlpha = tower.level >= 3 ? 0.35 : 0.22;
      const glowRadius = radius * (tower.level >= 3 ? 1.7 : 1.4);
      visual.glow.setRadius(glowRadius);
      visual.glow.setFillStyle(color, glowAlpha);
    } else if (visual.glow) {
      visual.glow.setFillStyle(color, 0);
    }

    visual.label.setText(`T${tower.level}`);
    visual.label.setFontSize(Math.max(8, Math.floor(cellSize * 0.4)));
  }

  private playTowerPopAnimation(container: Phaser.GameObjects.Container): void {
    if (this.reducedMotion) {
      container.setScale(1);
      return;
    }
    container.setScale(0);
    this.tweens.add({
      targets: container,
      scale: 1.15,
      duration: POP_DURATION_MS * 0.6,
      ease: "Back.Out",
      onComplete: () => {
        this.tweens.add({
          targets: container,
          scale: 1,
          duration: POP_DURATION_MS * 0.4,
          ease: "Sine.InOut"
        });
      }
    });
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

export interface BattlefieldMountOptions {
  onCellClick?: (x: number, y: number) => void;
}

export interface BattlefieldMount {
  renderMap(snapshot: MatchSnapshot | null): void;
  setCursor(x: number, y: number): void;
  setPlacementContext(context: PlacementContext): void;
  destroy(): void;
}

export function createBattlefieldMount(container: HTMLElement, options: BattlefieldMountOptions = {}): BattlefieldMount {
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: container,
    transparent: true,
    width: 1,
    height: 1,
    scene: []
  });

  const scene = new BattlefieldScene();
  scene.setOnCellClick(options.onCellClick);
  game.scene.add("battlefield", scene, true);

  return {
    renderMap(snapshot: MatchSnapshot | null): void {
      scene?.renderSnapshot(snapshot);
    },
    setCursor(x: number, y: number): void {
      scene?.setCursor(x, y);
    },
    setPlacementContext(context: PlacementContext): void {
      scene?.setPlacementContext(context);
    },
    destroy(): void {
      game.destroy(true);
    }
  };
}
