import Phaser from "phaser";

import { MOVEMENT_PROGRESS_UNITS_PER_CELL } from "@tower-defense/shared";
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
const TERRAIN_TEXTURE_KEY = "terrain-base";

export function cellSizeForWidth(width: number): number {
  if (width > 40) {
    return 12;
  }
  if (width > 24) {
    return 16;
  }
  return 24;
}

function cssColor(color: number): string {
  return `#${color.toString(16).padStart(6, "0")}`;
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

interface CreatureVisual {
  container: Phaser.GameObjects.Container;
  disc: Phaser.GameObjects.Arc;
  glyph: Phaser.GameObjects.Text;
  archetype: CreatureArchetype;
  // Logical (cell-space) motion segment; current* is what is drawn this frame.
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  curX: number;
  curY: number;
  dirX: number;
  dirY: number;
  cellX: number;
  cellY: number;
  startedAt: number;
  durationMs: number;
}

class BattlefieldScene extends Phaser.Scene {
  private terrainImage: Phaser.GameObjects.Image | undefined;
  private wearGraphics?: Phaser.GameObjects.Graphics;
  private mapKey: string | null = null;
  private wearSignature = -1;
  private wallVisuals = new Map<string, Phaser.GameObjects.Rectangle>();
  private creatureVisuals = new Map<string, CreatureVisual>();
  private creaturePool: CreatureVisual[] = [];
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

    this.wearGraphics = this.add.graphics().setDepth(DEPTH_TERRAIN + 0.5);
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
      this.draw(this.pendingSnapshot, 0);
    } else {
      this.drawCursor();
    }
  }

  renderSnapshot(snapshot: MatchSnapshot | null, transitionMs = 0): void {
    if (!this.wearGraphics) {
      this.pendingSnapshot = snapshot;
      return;
    }
    this.draw(snapshot, transitionMs);
  }

  // Test/diagnostic view of the pooled creature objects (cell-space positions as drawn this frame).
  creaturePositions(): Array<{ id: string; x: number; y: number }> {
    return [...this.creatureVisuals.entries()].map(([id, visual]) => ({ id, x: visual.curX, y: visual.curY }));
  }

  override update(): void {
    if (document.hidden || this.creatureVisuals.size === 0) {
      return;
    }
    const now = performance.now();
    const cellSize = this.cellSize;
    for (const visual of this.creatureVisuals.values()) {
      const t = visual.durationMs <= 0 ? 1 : Math.min(1, (now - visual.startedAt) / visual.durationMs);
      visual.curX = visual.fromX + (visual.toX - visual.fromX) * t;
      visual.curY = visual.fromY + (visual.toY - visual.fromY) * t;
      visual.container.setPosition(visual.curX * cellSize, visual.curY * cellSize);
    }
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

  // Phaser 4 caches the canvas position, so pointer.x/y drift when the page layout shifts after setup.
  // Measuring the canvas at event time keeps cell hit-testing correct.
  private cellFromPointer(pointer: Phaser.Input.Pointer): { x: number; y: number } {
    const rect = this.game.canvas.getBoundingClientRect();
    const event = pointer.event as MouseEvent | undefined;
    const localX = event && rect.width > 0 ? (event.clientX - rect.left) * (this.game.canvas.width / rect.width) : pointer.x;
    const localY = event && rect.height > 0 ? (event.clientY - rect.top) * (this.game.canvas.height / rect.height) : pointer.y;
    return { x: Math.floor(localX / this.cellSize), y: Math.floor(localY / this.cellSize) };
  }

  private handlePointerDown(pointer: Phaser.Input.Pointer): void {
    const { x, y } = this.cellFromPointer(pointer);
    if (!this.isHoverValid(x, y)) {
      this.playInvalidClickFlash(x, y);
    }
    if (this.onCellClick) {
      this.onCellClick(x, y);
    }
  }

  private handlePointerMove = (pointer: Phaser.Input.Pointer): void => {
    const { x, y } = this.cellFromPointer(pointer);
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

  private draw(snapshot: MatchSnapshot | null, transitionMs: number): void {
    if (!this.wearGraphics) {
      return;
    }

    if (!snapshot) {
      this.cellsByKey = new Map();
      this.occupiedCells = new Set();
      this.mapKey = null;
      this.terrainImage?.destroy();
      this.terrainImage = undefined;
      this.wearGraphics.clear();
      this.wearSignature = -1;
      for (const visual of this.towerVisuals.values()) {
        visual.container.destroy();
      }
      this.towerVisuals.clear();
      this.syncWalls([], this.cellSize);
      this.syncCreatures([], this.cellSize, 0);
      this.drawCursor();
      this.drawHoverAndGhost();
      return;
    }

    const { width, height, seed } = snapshot.map;
    const cellSize = cellSizeForWidth(width);
    const mapKey = `${seed}:${width}x${height}`;
    if (mapKey !== this.mapKey) {
      this.rebuildMap(snapshot.map, mapKey, cellSize);
    }
    this.syncWear(snapshot.map.cells, cellSize);

    const occupiedCells = new Set<string>();
    for (const tower of snapshot.towers) {
      occupiedCells.add(`${tower.x},${tower.y}`);
    }
    for (const wall of snapshot.walls) {
      occupiedCells.add(`${wall.x},${wall.y}`);
    }
    this.occupiedCells = occupiedCells;

    this.syncWalls(snapshot.walls, cellSize);
    this.drawTowers(snapshot.towers, cellSize);
    this.syncCreatures(snapshot.creatures, cellSize, transitionMs);
    this.drawHoverAndGhost();
  }

  // Runs only when the map identity (seed + size) changes: indexes cells, bakes terrain once, resizes the canvas.
  private rebuildMap(map: MatchSnapshot["map"], mapKey: string, cellSize: number): void {
    this.mapKey = mapKey;
    this.cellSize = cellSize;
    const cellsByKey = new Map<string, MatchSnapshot["map"]["cells"][number]>();
    for (const cell of map.cells) {
      cellsByKey.set(`${cell.x},${cell.y}`, cell);
    }
    this.cellsByKey = cellsByKey;

    const pixelWidth = map.width * cellSize;
    const pixelHeight = map.height * cellSize;

    // A canvas texture (rather than Graphics) is uploaded once; Graphics would be re-tessellated every frame.
    this.terrainImage?.destroy();
    if (this.textures.exists(TERRAIN_TEXTURE_KEY)) {
      this.textures.remove(TERRAIN_TEXTURE_KEY);
    }
    const texture = this.textures.createCanvas(TERRAIN_TEXTURE_KEY, pixelWidth, pixelHeight);
    if (texture) {
      const ctx = texture.context;
      ctx.fillStyle = cssColor(COLOR_BLOCKED);
      ctx.fillRect(0, 0, pixelWidth, pixelHeight);
      for (const cell of map.cells) {
        ctx.fillStyle = cssColor(cell.buildable ? COLOR_BUILDABLE : COLOR_PATH);
        ctx.fillRect(cell.x * cellSize, cell.y * cellSize, cellSize, cellSize);
      }
      texture.refresh();
      this.terrainImage = this.add.image(0, 0, TERRAIN_TEXTURE_KEY).setOrigin(0, 0).setDepth(DEPTH_TERRAIN);
    }

    // Entity ids repeat across matches (e.g. "tower-p1"), so never carry visuals over to a different map.
    for (const visual of this.towerVisuals.values()) {
      visual.container.destroy();
    }
    this.towerVisuals.clear();
    this.hasRenderedTowersOnce = false;
    for (const visual of this.creatureVisuals.values()) {
      visual.container.setVisible(false);
      this.creaturePool.push(visual);
    }
    this.creatureVisuals.clear();

    this.wearSignature = -1;
    this.game.scale.resize(pixelWidth, pixelHeight);
    this.drawCursor();
  }

  // Worn path cells are a small overlay so the baked terrain never has to be redrawn for wear changes.
  private syncWear(cells: MatchSnapshot["map"]["cells"], cellSize: number): void {
    const graphics = this.wearGraphics;
    if (!graphics) {
      return;
    }
    let signature = 0;
    for (let index = 0; index < cells.length; index += 1) {
      const wear = cells[index]?.pathWear ?? 0;
      if (wear > 0) {
        signature = (signature * 31 + index + 1 + wear * 7919) % 2147483629;
      }
    }
    if (signature === this.wearSignature) {
      return;
    }
    this.wearSignature = signature;
    graphics.clear();
    graphics.fillStyle(COLOR_PATH_WORN, 1);
    for (const cell of cells) {
      if (!cell.buildable && cell.pathWear > 0) {
        graphics.fillRect(cell.x * cellSize, cell.y * cellSize, cellSize, cellSize);
      }
    }
  }

  private syncWalls(walls: Wall[], cellSize: number): void {
    const wallWidth = cellSize * 0.75;
    const wallHeight = cellSize * 0.375;
    const seen = new Set<string>();
    for (const wall of walls) {
      seen.add(wall.id);
      const { cx, cy } = cellCenter(wall.x, wall.y, cellSize);
      let visual = this.wallVisuals.get(wall.id);
      if (!visual) {
        visual = this.add.rectangle(cx, cy, wallWidth, wallHeight, COLOR_WALL, 1).setDepth(DEPTH_WALLS);
        this.wallVisuals.set(wall.id, visual);
      } else if (visual.x !== cx || visual.y !== cy || visual.width !== wallWidth) {
        visual.setPosition(cx, cy);
        visual.setSize(wallWidth, wallHeight);
      }
    }
    for (const [id, visual] of this.wallVisuals) {
      if (!seen.has(id)) {
        visual.destroy();
        this.wallVisuals.delete(id);
      }
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

    const labelText = `T${tower.level}`;
    if (visual.label.text !== labelText) {
      visual.label.setText(labelText);
    }
    const fontSize = Math.max(8, Math.floor(cellSize * 0.4));
    if (visual.label.style.fontSize !== `${fontSize}px`) {
      visual.label.setFontSize(fontSize);
    }
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

  private acquireCreatureVisual(archetype: CreatureArchetype, cellSize: number): CreatureVisual {
    const pooled = this.creaturePool.pop();
    const fontSize = `${Math.max(8, Math.floor(cellSize * 0.35))}px`;
    if (pooled) {
      pooled.container.setVisible(true);
      pooled.disc.setRadius(cellSize * 0.3);
      pooled.glyph.setFontSize(fontSize);
      if (pooled.archetype !== archetype) {
        pooled.glyph.setText(CREATURE_GLYPH[archetype]);
        pooled.archetype = archetype;
      }
      return pooled;
    }
    const disc = this.add.circle(0, 0, cellSize * 0.3, COLOR_CREATURE, 1);
    const glyph = this.add.text(0, 0, CREATURE_GLYPH[archetype], { fontSize, color: "#ffffff" }).setOrigin(0.5, 0.5);
    const container = this.add.container(0, 0, [disc, glyph]).setDepth(DEPTH_CREATURES);
    return {
      container, disc, glyph, archetype,
      fromX: 0, fromY: 0, toX: 0, toY: 0, curX: 0, curY: 0,
      dirX: 1, dirY: 0, cellX: 0, cellY: 0, startedAt: 0, durationMs: 0
    };
  }

  // Creatures are keyed by id and moved in place; update() interpolates between successive snapshot positions.
  private syncCreatures(creatures: Creature[], cellSize: number, transitionMs: number): void {
    const now = performance.now();
    const seen = new Set<string>();
    for (const creature of creatures) {
      seen.add(creature.id);
      let visual = this.creatureVisuals.get(creature.id);
      const isNew = !visual;
      if (!visual) {
        visual = this.acquireCreatureVisual(creature.archetype, cellSize);
        this.creatureVisuals.set(creature.id, visual);
      }

      if (!isNew) {
        const dx = creature.x - visual.cellX;
        const dy = creature.y - visual.cellY;
        if (Math.abs(dx) + Math.abs(dy) === 1) {
          visual.dirX = dx;
          visual.dirY = dy;
        }
      }
      visual.cellX = creature.x;
      visual.cellY = creature.y;

      // pathProgressUnits (100 per cell) is the fraction travelled towards the next path cell.
      const progress = creature.pathProgressUnits / MOVEMENT_PROGRESS_UNITS_PER_CELL;
      const targetX = creature.x + 0.5 + visual.dirX * progress;
      const targetY = creature.y + 0.5 + visual.dirY * progress;

      if (isNew) {
        visual.fromX = targetX;
        visual.fromY = targetY;
        visual.curX = targetX;
        visual.curY = targetY;
        visual.durationMs = 0;
        visual.container.setPosition(targetX * cellSize, targetY * cellSize);
      } else {
        visual.fromX = visual.curX;
        visual.fromY = visual.curY;
        visual.durationMs = transitionMs;
      }
      visual.toX = targetX;
      visual.toY = targetY;
      visual.startedAt = now;
    }

    for (const [id, visual] of this.creatureVisuals) {
      if (!seen.has(id)) {
        visual.container.setVisible(false);
        this.creaturePool.push(visual);
        this.creatureVisuals.delete(id);
      }
    }
  }
}

export interface BattlefieldMountOptions {
  onCellClick?: (x: number, y: number) => void;
}

export interface BattlefieldMount {
  renderMap(snapshot: MatchSnapshot | null, transitionMs?: number): void;
  creaturePositions(): Array<{ id: string; x: number; y: number }>;
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
    renderMap(snapshot: MatchSnapshot | null, transitionMs = 0): void {
      scene?.renderSnapshot(snapshot, transitionMs);
    },
    creaturePositions(): Array<{ id: string; x: number; y: number }> {
      return scene.creaturePositions();
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
