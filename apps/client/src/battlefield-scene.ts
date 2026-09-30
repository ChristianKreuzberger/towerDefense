import Phaser from "phaser";

import { CREATURE_ARCHETYPE_STATS, MOVEMENT_PROGRESS_UNITS_PER_CELL, PATH_CELL_MAX_WEAR } from "@tower-defense/shared";
import type { Creature, CreatureArchetype, MapCell, MatchEvent, MatchPhase, MatchSnapshot, Tower, Wall } from "@tower-defense/shared";

import { Effects } from "./art/fx";
import { CREAM, INK, UI_COLORS, colorForPlayer, playerIndex } from "./art/palette";
import { paintTerrain } from "./art/paint";
import { KEY, SS, TOWER_SCALE, ensureTextures } from "./art/textures";

const DEPTH_TERRAIN = 0;
const DEPTH_WEAR = 0.5;
const DEPTH_WALLS = 1;
const DEPTH_TOWERS = 2;
const DEPTH_CREATURES = 3;
const DEPTH_FX = 4;
const DEPTH_CURSOR = 5;
const DEPTH_HOVER = 6;
const DEPTH_FLASH = 7;

const POP_DURATION_MS = 220;
const TERRAIN_TEXTURE_KEY = "terrain-base";
const INV = 1 / SS;
// Bounds the work one snapshot can cause even if a long batch (or a reconnect) delivers hundreds of events.
const MAX_FX_EVENTS = 40;
const FLASH_MS = 200;
const SHAKE_MS = 220;
const RECOIL_MS = 140;

// Internal resolution per map size; CSS scales the canvas to fit the container.
export function cellSizeForWidth(width: number): number {
  if (width > 40) {
    return 16;
  }
  if (width > 24) {
    return 22;
  }
  return 28;
}

function cellCenter(x: number, y: number, cellSize: number): { cx: number; cy: number } {
  return { cx: x * cellSize + cellSize / 2, cy: y * cellSize + cellSize / 2 };
}

function approachAngle(current: number, target: number, amount: number): number {
  let delta = target - current;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return current + delta * Math.min(1, amount);
}

export interface PlacementContext {
  phase: MatchPhase;
  playerId: string;
  hasTowerAlready: boolean;
  wallMode?: boolean;
}

interface TowerVisual {
  container: Phaser.GameObjects.Container;
  base: Phaser.GameObjects.Image;
  turret: Phaser.GameObjects.Image;
  pips: Phaser.GameObjects.Image;
  hpBg: Phaser.GameObjects.Image;
  hpFill: Phaser.GameObjects.Image;
  flash: Phaser.GameObjects.Image;
  player: number;
  level: number;
  hp: number;
  maxHp: number;
  angle: number;
  targetId: string | null;
  baseX: number;
  baseY: number;
  flashUntil: number;
  shakeUntil: number;
  recoilUntil: number;
}

interface CreatureVisual {
  container: Phaser.GameObjects.Container;
  sprite: Phaser.GameObjects.Image;
  hpBg: Phaser.GameObjects.Image;
  hpFill: Phaser.GameObjects.Image;
  archetype: CreatureArchetype;
  hp: number;
  phase: number;
  heading: number;
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

interface WallVisual {
  image: Phaser.GameObjects.Image;
  player: number;
  crack: number;
}

function crackLevel(wall: Wall): number {
  const ratio = wall.maxHealth > 0 ? wall.health / wall.maxHealth : 1;
  if (ratio <= 0.33) {
    return 2;
  }
  return ratio <= 0.66 ? 1 : 0;
}

function hpColor(ratio: number): number {
  if (ratio > 0.6) {
    return 0x7fd08a;
  }
  return ratio > 0.3 ? 0xf2b84b : 0xe0675a;
}

class BattlefieldScene extends Phaser.Scene {
  private terrainImage: Phaser.GameObjects.Image | undefined;
  private wearImages = new Map<number, Phaser.GameObjects.Image>();
  private mapKey: string | null = null;
  private wearSignature = -1;
  private wallVisuals = new Map<string, WallVisual>();
  private creatureVisuals = new Map<string, CreatureVisual>();
  private creaturePool: CreatureVisual[] = [];
  private cursorGraphics?: Phaser.GameObjects.Graphics;
  private hoverGraphics?: Phaser.GameObjects.Graphics;
  private linkGraphics?: Phaser.GameObjects.Graphics;
  private ghostBase?: Phaser.GameObjects.Image;
  private ghostTurret?: Phaser.GameObjects.Image;
  private ghostWall?: Phaser.GameObjects.Image;
  private fx?: Effects;
  private towerVisuals = new Map<string, TowerVisual>();
  private towerAtCell = new Map<string, string>();
  private hasRenderedTowersOnce = false;
  private pendingSnapshot: MatchSnapshot | null = null;
  private pendingEvents: MatchEvent[] = [];
  private cellSize = 28;
  private cursorX: number | null = null;
  private cursorY: number | null = null;
  private pendingCursor: { x: number; y: number } | null = null;
  private onCellClick: ((x: number, y: number) => void) | undefined;
  private placementContext: PlacementContext | undefined;
  private cellsByKey = new Map<string, MapCell>();
  private occupiedCells = new Set<string>();
  private hoverX: number | null = null;
  private hoverY: number | null = null;
  private hoverTowerId: string | null = null;
  private reducedMotion = false;
  private lastWave = -1;
  private lastWaveTick = 0;
  private lastFrame = 0;

  constructor() {
    super("battlefield");
  }

  create(): void {
    this.reducedMotion = typeof window !== "undefined"
      && typeof window.matchMedia === "function"
      && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    ensureTextures(this, this.cellSize);
    this.fx = new Effects(this, this.cellSize, DEPTH_FX, this.reducedMotion);
    this.cursorGraphics = this.add.graphics().setDepth(DEPTH_CURSOR);
    this.hoverGraphics = this.add.graphics().setDepth(DEPTH_HOVER);
    this.linkGraphics = this.add.graphics().setDepth(DEPTH_HOVER);
    this.ghostBase = this.add.image(0, 0, KEY.towerBase(0)).setDepth(DEPTH_HOVER).setVisible(false).setScale(INV).setAlpha(0.75);
    this.ghostTurret = this.add.image(0, 0, KEY.turret(0, 1)).setDepth(DEPTH_HOVER).setVisible(false).setScale(INV).setAlpha(0.75);
    this.ghostWall = this.add.image(0, 0, KEY.wall(0, 0)).setDepth(DEPTH_HOVER).setVisible(false).setScale(INV).setAlpha(0.6);
    this.input.on("pointerdown", this.handlePointerDown, this);
    this.input.on("pointermove", this.handlePointerMove, this);
    this.game.canvas.addEventListener("pointerleave", this.handlePointerLeave);
    if (this.pendingCursor !== null) {
      this.cursorX = this.pendingCursor.x;
      this.cursorY = this.pendingCursor.y;
      this.pendingCursor = null;
    }
    if (this.pendingSnapshot !== null) {
      this.draw(this.pendingSnapshot, 0, this.pendingEvents);
      this.pendingSnapshot = null;
      this.pendingEvents = [];
    } else {
      this.drawCursor();
    }
  }

  renderSnapshot(snapshot: MatchSnapshot | null, transitionMs = 0, events: MatchEvent[] = []): void {
    if (!this.cursorGraphics) {
      this.pendingSnapshot = snapshot;
      this.pendingEvents = events;
      return;
    }
    this.draw(snapshot, transitionMs, events);
  }

  // Test/diagnostic view of the pooled creature objects (cell-space positions as drawn this frame).
  creaturePositions(): Array<{ id: string; x: number; y: number }> {
    return [...this.creatureVisuals.entries()].map(([id, visual]) => ({ id, x: visual.curX, y: visual.curY }));
  }

  // CSS pixel position of a cell centre relative to the canvas element, valid under any CSS scaling.
  cellToCss(x: number, y: number): { x: number; y: number } {
    const canvas = this.game.canvas;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width > 0 ? rect.width / canvas.width : 1;
    const scaleY = canvas.height > 0 ? rect.height / canvas.height : 1;
    return { x: (x + 0.5) * this.cellSize * scaleX, y: (y + 0.5) * this.cellSize * scaleY };
  }

  getCellSize(): number {
    return this.cellSize;
  }

  override update(): void {
    if (document.hidden) {
      return;
    }
    const now = performance.now();
    const dt = this.lastFrame === 0 ? 16 : Math.min(64, now - this.lastFrame);
    this.lastFrame = now;
    const cellSize = this.cellSize;

    for (const visual of this.creatureVisuals.values()) {
      const t = visual.durationMs <= 0 ? 1 : Math.min(1, (now - visual.startedAt) / visual.durationMs);
      visual.curX = visual.fromX + (visual.toX - visual.fromX) * t;
      visual.curY = visual.fromY + (visual.toY - visual.fromY) * t;
      visual.container.setPosition(visual.curX * cellSize, visual.curY * cellSize);
      const targetHeading = Math.atan2(visual.dirY, visual.dirX);
      visual.heading = this.reducedMotion ? targetHeading : approachAngle(visual.heading, targetHeading, dt * 0.018);
      const bob = this.reducedMotion ? 0 : Math.sin(now * 0.014 + visual.phase);
      visual.sprite.setRotation(visual.heading + bob * 0.07);
      visual.sprite.setPosition(0, bob * cellSize * 0.035);
    }

    for (const visual of this.towerVisuals.values()) {
      this.updateTowerFrame(visual, now, dt);
    }

    this.fx?.update(now);
    this.drawTowerLink();
  }

  private updateTowerFrame(visual: TowerVisual, now: number, dt: number): void {
    const cellSize = this.cellSize;
    let target: CreatureVisual | undefined;
    if (visual.targetId) {
      target = this.creatureVisuals.get(visual.targetId);
    }
    if (target) {
      const goal = Math.atan2(target.curY * cellSize - visual.baseY, target.curX * cellSize - visual.baseX);
      visual.angle = this.reducedMotion ? goal : approachAngle(visual.angle, goal, dt * 0.02);
    }
    visual.turret.setRotation(visual.angle);

    let recoil = 0;
    if (now < visual.recoilUntil && !this.reducedMotion) {
      recoil = ((visual.recoilUntil - now) / RECOIL_MS) * cellSize * 0.1;
    }
    visual.turret.setPosition(-Math.cos(visual.angle) * recoil, -Math.sin(visual.angle) * recoil);

    if (now < visual.flashUntil) {
      visual.flash.setAlpha(0.65 * ((visual.flashUntil - now) / FLASH_MS)).setVisible(true);
    } else if (visual.flash.visible) {
      visual.flash.setVisible(false);
    }
    if (now < visual.shakeUntil && !this.reducedMotion) {
      const power = (visual.shakeUntil - now) / SHAKE_MS;
      visual.container.setPosition(
        visual.baseX + Math.sin(now * 0.09) * cellSize * 0.09 * power,
        visual.baseY + Math.cos(now * 0.11) * cellSize * 0.06 * power
      );
    } else if (visual.container.x !== visual.baseX || visual.container.y !== visual.baseY) {
      visual.container.setPosition(visual.baseX, visual.baseY);
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
  // Measuring the canvas at event time keeps cell hit-testing correct, including under CSS scaling.
  private cellFromPointer(pointer: Phaser.Input.Pointer): { x: number; y: number } {
    const rect = this.game.canvas.getBoundingClientRect();
    const source = pointer.event as MouseEvent | TouchEvent | undefined;
    // Touch events carry coordinates on the touch point, not on the event itself.
    const point = source && "changedTouches" in source ? source.changedTouches[0] : (source as MouseEvent | undefined);
    const clientX = point?.clientX;
    const clientY = point?.clientY;
    const localX = clientX !== undefined && rect.width > 0 ? (clientX - rect.left) * (this.game.canvas.width / rect.width) : pointer.x;
    const localY = clientY !== undefined && rect.height > 0 ? (clientY - rect.top) * (this.game.canvas.height / rect.height) : pointer.y;
    return { x: Math.floor(localX / this.cellSize), y: Math.floor(localY / this.cellSize) };
  }

  private handlePointerDown(pointer: Phaser.Input.Pointer): void {
    const { x, y } = this.cellFromPointer(pointer);
    if (!this.isHoverValid(x, y) && !this.towerAtCell.has(`${x},${y}`)) {
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
    this.hoverTowerId = this.towerAtCell.get(`${x},${y}`) ?? null;
    this.drawHoverAndGhost();
  };

  private handlePointerLeave = (): void => {
    this.hoverX = null;
    this.hoverY = null;
    this.hoverTowerId = null;
    this.drawHoverAndGhost();
  };

  private isHoverValid(x: number, y: number): boolean {
    const context = this.placementContext;
    if (!context) {
      return false;
    }
    const allowedPhase = context.wallMode ? context.phase !== "ended" : context.phase === "placement";
    if (!allowedPhase) {
      return false;
    }
    const cell = this.cellsByKey.get(`${x},${y}`);
    if (!cell || !cell.buildable) {
      return false;
    }
    return !this.occupiedCells.has(`${x},${y}`);
  }

  private isGhostValid(x: number, y: number): boolean {
    if (!this.placementContext) {
      return false;
    }
    if (!this.placementContext.wallMode && this.placementContext.hasTowerAlready) {
      return false;
    }
    return this.isHoverValid(x, y);
  }

  private drawHoverAndGhost(): void {
    const hover = this.hoverGraphics;
    const ghostBase = this.ghostBase;
    const ghostTurret = this.ghostTurret;
    const ghostWall = this.ghostWall;
    if (!hover || !ghostBase || !ghostTurret || !ghostWall) {
      return;
    }
    hover.clear();
    ghostBase.setVisible(false);
    ghostTurret.setVisible(false);
    ghostWall.setVisible(false);

    const cellSize = this.cellSize;
    // The active player's tower gets a steady ring so it is easy to find on a busy board.
    const activeId = this.placementContext ? `tower-${this.placementContext.playerId}` : null;
    const activeTower = activeId ? this.towerVisuals.get(activeId) : undefined;
    if (activeTower) {
      hover.lineStyle(Math.max(2, cellSize * 0.07), CREAM, 0.85);
      hover.strokeCircle(activeTower.baseX, activeTower.baseY, cellSize * 1.0);
    }
    if (this.hoverTowerId) {
      const hovered = this.towerVisuals.get(this.hoverTowerId);
      if (hovered) {
        hover.lineStyle(Math.max(2, cellSize * 0.08), UI_COLORS.hover, 0.95);
        hover.strokeCircle(hovered.baseX, hovered.baseY, cellSize * 1.08);
      }
    }

    if (this.hoverX === null || this.hoverY === null) {
      return;
    }
    const x = this.hoverX;
    const y = this.hoverY;
    if (!this.isHoverValid(x, y)) {
      return;
    }

    const radius = cellSize * 0.14;
    hover.fillStyle(UI_COLORS.hover, 0.22);
    hover.fillRoundedRect(x * cellSize, y * cellSize, cellSize, cellSize, radius);
    hover.lineStyle(2, UI_COLORS.hover, 0.9);
    hover.strokeRoundedRect(x * cellSize + 1, y * cellSize + 1, cellSize - 2, cellSize - 2, radius);

    if (this.isGhostValid(x, y) && this.placementContext) {
      const { cx, cy } = cellCenter(x, y, cellSize);
      const index = playerIndex(this.placementContext.playerId);
      if (this.placementContext.wallMode) {
        ghostWall.setTexture(KEY.wall(index, 0)).setPosition(cx, cy).setVisible(true);
      } else {
        ghostBase.setTexture(KEY.towerBase(index)).setPosition(cx, cy).setVisible(true);
        ghostTurret.setTexture(KEY.turret(index, 1)).setPosition(cx, cy).setVisible(true);
      }
    }
  }

  // Hovering a tower links it to its current target; towers have no range limit in the simulation, so there is no range ring.
  private drawTowerLink(): void {
    const graphics = this.linkGraphics;
    if (!graphics) {
      return;
    }
    graphics.clear();
    if (!this.hoverTowerId) {
      return;
    }
    const tower = this.towerVisuals.get(this.hoverTowerId);
    const target = tower?.targetId ? this.creatureVisuals.get(tower.targetId) : undefined;
    if (!tower || !target) {
      return;
    }
    const cellSize = this.cellSize;
    graphics.lineStyle(Math.max(2, cellSize * 0.07), UI_COLORS.hover, 0.6);
    graphics.lineBetween(tower.baseX, tower.baseY, target.curX * cellSize, target.curY * cellSize);
    graphics.strokeCircle(target.curX * cellSize, target.curY * cellSize, cellSize * 0.6);
  }

  private playInvalidClickFlash(x: number, y: number): void {
    const cellSize = this.cellSize;
    const { cx, cy } = cellCenter(x, y, cellSize);
    const rect = this.add
      .rectangle(cx, cy, cellSize, cellSize, UI_COLORS.invalid, 0.4)
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
    graphics.lineStyle(2, UI_COLORS.cursor, 0.95);
    graphics.strokeRoundedRect(x + 1, y + 1, cellSize - 2, cellSize - 2, cellSize * 0.14);
  }

  private resetVisuals(): void {
    for (const visual of this.towerVisuals.values()) {
      visual.container.destroy();
    }
    this.towerVisuals.clear();
    this.towerAtCell.clear();
    this.hoverTowerId = null;
    this.hasRenderedTowersOnce = false;
    this.fx?.clear();
  }

  private draw(snapshot: MatchSnapshot | null, transitionMs: number, events: MatchEvent[]): void {
    if (!this.cursorGraphics) {
      return;
    }

    if (!snapshot) {
      this.cellsByKey = new Map();
      this.occupiedCells = new Set();
      this.mapKey = null;
      this.terrainImage?.destroy();
      this.terrainImage = undefined;
      for (const image of this.wearImages.values()) {
        image.setVisible(false);
      }
      this.wearSignature = -1;
      this.resetVisuals();
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
      this.lastWave = -1;
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

    // Effects read the pooled visuals of the previous snapshot, so they must run before the sync calls retire them.
    this.playEvents(events, snapshot, transitionMs);
    this.lastWave = snapshot.wave;
    this.lastWaveTick = snapshot.waveTick;

    this.syncWalls(snapshot.walls, cellSize);
    this.syncTowers(snapshot, cellSize);
    this.syncCreatures(snapshot.creatures, cellSize, transitionMs);
    this.drawHoverAndGhost();
  }

  // Runs only when the map identity (seed + size) changes: indexes cells, bakes terrain once, resizes the canvas.
  private rebuildMap(map: MatchSnapshot["map"], mapKey: string, cellSize: number): void {
    this.mapKey = mapKey;
    this.cellSize = cellSize;
    ensureTextures(this, cellSize);
    this.fx?.setCellSize(cellSize);

    const cellsByKey = new Map<string, MapCell>();
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
      paintTerrain(texture.context, map.cells, map.width, map.height, cellSize, map.seed);
      texture.refresh();
      this.terrainImage = this.add.image(0, 0, TERRAIN_TEXTURE_KEY).setOrigin(0, 0).setDepth(DEPTH_TERRAIN);
    }

    // Entity ids repeat across matches (e.g. "tower-p1"), so never carry visuals over to a different map.
    this.resetVisuals();
    for (const visual of this.wallVisuals.values()) {
      visual.image.destroy();
    }
    this.wallVisuals.clear();
    for (const image of this.wearImages.values()) {
      image.destroy();
    }
    this.wearImages.clear();
    for (const visual of this.creatureVisuals.values()) {
      visual.container.setVisible(false);
      this.creaturePool.push(visual);
    }
    this.creatureVisuals.clear();
    // Pooled visuals were sized for the previous cell size.
    for (const visual of this.creaturePool) {
      visual.container.destroy();
    }
    this.creaturePool = [];

    this.wearSignature = -1;
    this.game.scale.resize(pixelWidth, pixelHeight);
    this.drawCursor();
  }

  // Worn cells are a small pooled overlay so the baked terrain never has to be redrawn for wear changes.
  private syncWear(cells: MapCell[], cellSize: number): void {
    if (!this.terrainImage) {
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
    const used = new Set<number>();
    for (let index = 0; index < cells.length; index += 1) {
      const cell = cells[index];
      if (!cell || cell.pathWear <= 0) {
        continue;
      }
      used.add(index);
      let image = this.wearImages.get(index);
      if (!image) {
        image = this.add.image(cell.x * cellSize, cell.y * cellSize, KEY.rut).setOrigin(0, 0).setDepth(DEPTH_WEAR);
        this.wearImages.set(index, image);
      }
      image.setVisible(true).setAlpha(0.3 + 0.7 * Math.min(1, cell.pathWear / PATH_CELL_MAX_WEAR));
    }
    for (const [index, image] of this.wearImages) {
      if (!used.has(index)) {
        image.setVisible(false);
      }
    }
  }

  private syncWalls(walls: Wall[], cellSize: number): void {
    const seen = new Set<string>();
    for (const wall of walls) {
      seen.add(wall.id);
      const player = playerIndex(wall.playerId);
      const crack = crackLevel(wall);
      let visual = this.wallVisuals.get(wall.id);
      if (!visual) {
        const image = this.add
          .image(wall.x * cellSize + cellSize / 2, wall.y * cellSize + cellSize / 2, KEY.wall(player, crack))
          .setScale(INV)
          .setDepth(DEPTH_WALLS);
        visual = { image, player, crack };
        this.wallVisuals.set(wall.id, visual);
      } else if (visual.crack !== crack || visual.player !== player) {
        visual.image.setTexture(KEY.wall(player, crack));
        visual.crack = crack;
        visual.player = player;
      }
    }
    for (const [id, visual] of this.wallVisuals) {
      if (!seen.has(id)) {
        visual.image.destroy();
        this.wallVisuals.delete(id);
      }
    }
  }

  private syncTowers(snapshot: MatchSnapshot, cellSize: number): void {
    const seen = new Set<string>();
    const skipPopAnimation = !this.hasRenderedTowersOnce;
    const targetByTower = new Map<string, string | null>();
    for (const assignment of snapshot.targetAssignments) {
      targetByTower.set(assignment.towerId, assignment.targetCreatureId);
    }
    this.towerAtCell.clear();

    for (const tower of snapshot.towers) {
      seen.add(tower.id);
      this.towerAtCell.set(`${tower.x},${tower.y}`, tower.id);
      let visual = this.towerVisuals.get(tower.id);
      const isNew = !visual;
      if (!visual) {
        visual = this.createTowerVisual(tower, cellSize);
        this.towerVisuals.set(tower.id, visual);
      }
      visual.targetId = snapshot.phase === "wave" ? (targetByTower.get(tower.id) ?? null) : null;
      this.updateTowerVisual(visual, tower, cellSize);
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
    const player = playerIndex(tower.playerId);
    const container = this.add.container(cx, cy).setDepth(DEPTH_TOWERS);

    const shadow = this.add.image(0, cellSize * 0.2, KEY.shadow).setDisplaySize(cellSize * TOWER_SCALE * 1.05, cellSize * 1.15);
    const base = this.add.image(0, 0, KEY.towerBase(player)).setScale(INV);
    const flash = this.add.image(0, 0, KEY.soft).setTint(0xff5a4a).setDisplaySize(cellSize * 2, cellSize * 2).setVisible(false);
    const turret = this.add.image(0, 0, KEY.turret(player, tower.level)).setScale(INV);
    const badge = this.add.image(cellSize * 0.74, cellSize * 0.7, KEY.badge(player)).setScale(INV);
    const pips = this.add.image(0, cellSize * 1.12, KEY.pips(1)).setScale(INV).setVisible(false);
    const barWidth = cellSize * 1.5;
    const barHeight = cellSize * 0.2;
    const hpBg = this.add.image(-barWidth / 2 - 1, -cellSize * 1.22, KEY.px).setOrigin(0, 0.5).setTint(INK).setAlpha(0.85)
      .setDisplaySize(barWidth + 2, barHeight + 2);
    const hpFill = this.add.image(-barWidth / 2, -cellSize * 1.22, KEY.px).setOrigin(0, 0.5).setDisplaySize(barWidth, barHeight);

    container.add([shadow, base, flash, turret, badge, pips, hpBg, hpFill]);
    return {
      container, base, turret, pips, hpBg, hpFill, flash,
      player, level: tower.level, hp: -1, maxHp: tower.maxHealth, angle: 0, targetId: null,
      baseX: cx, baseY: cy, flashUntil: 0, shakeUntil: 0, recoilUntil: 0
    };
  }

  private updateTowerVisual(visual: TowerVisual, tower: Tower, cellSize: number): void {
    const { cx, cy } = cellCenter(tower.x, tower.y, cellSize);
    visual.baseX = cx;
    visual.baseY = cy;
    if (visual.level !== tower.level) {
      visual.level = tower.level;
      visual.turret.setTexture(KEY.turret(visual.player, tower.level));
    }
    if (tower.level >= 2) {
      visual.pips.setTexture(KEY.pips(tower.level - 1)).setVisible(true);
    } else {
      visual.pips.setVisible(false);
    }
    if (visual.hp !== tower.health || visual.maxHp !== tower.maxHealth) {
      visual.hp = tower.health;
      visual.maxHp = tower.maxHealth;
      const ratio = tower.maxHealth > 0 ? Math.max(0, Math.min(1, tower.health / tower.maxHealth)) : 0;
      visual.hpFill.setDisplaySize(Math.max(0, cellSize * 1.5 * ratio), cellSize * 0.2).setTint(hpColor(ratio));
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
    if (pooled) {
      pooled.container.setVisible(true);
      if (pooled.archetype !== archetype) {
        pooled.sprite.setTexture(KEY.creature(archetype));
        pooled.archetype = archetype;
      }
      return pooled;
    }
    const shadow = this.add.image(0, cellSize * 0.24, KEY.shadow).setDisplaySize(cellSize * 0.95, cellSize * 0.5);
    const sprite = this.add.image(0, 0, KEY.creature(archetype)).setScale(INV);
    const barWidth = cellSize * 0.95;
    const barHeight = cellSize * 0.15;
    const hpBg = this.add.image(-barWidth / 2 - 1, -cellSize * 0.72, KEY.px).setOrigin(0, 0.5).setTint(INK).setAlpha(0.85)
      .setDisplaySize(barWidth + 2, barHeight + 2).setVisible(false);
    const hpFill = this.add.image(-barWidth / 2, -cellSize * 0.72, KEY.px).setOrigin(0, 0.5)
      .setDisplaySize(barWidth, barHeight).setVisible(false);
    const container = this.add.container(0, 0, [shadow, sprite, hpBg, hpFill]).setDepth(DEPTH_CREATURES);
    return {
      container, sprite, hpBg, hpFill, archetype, hp: -1, phase: Math.random() * Math.PI * 2, heading: 0,
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
      } else {
        visual.dirX = 1;
        visual.dirY = 0;
        visual.heading = 0;
      }
      visual.cellX = creature.x;
      visual.cellY = creature.y;

      const maxHp = CREATURE_ARCHETYPE_STATS[creature.archetype].hp;
      if (visual.hp !== creature.hp) {
        visual.hp = creature.hp;
        const damaged = creature.hp < maxHp;
        visual.hpBg.setVisible(damaged);
        visual.hpFill.setVisible(damaged);
        if (damaged) {
          const ratio = Math.max(0, Math.min(1, creature.hp / maxHp));
          visual.hpFill.setDisplaySize(cellSize * 0.95 * ratio, cellSize * 0.15).setTint(hpColor(ratio));
        }
      }

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
        visual.hp = -1;
        this.creaturePool.push(visual);
        this.creatureVisuals.delete(id);
      }
    }
  }

  // Presentation only: derived from the snapshot's event tail, never fed back into the simulation.
  private playEvents(events: MatchEvent[], snapshot: MatchSnapshot, glideMs: number): void {
    const fx = this.fx;
    if (!fx || events.length === 0) {
      return;
    }
    const cellSize = this.cellSize;
    const sameWave = snapshot.wave === this.lastWave;
    const span = sameWave ? Math.max(1, snapshot.waveTick - this.lastWaveTick) : 1;
    const now = performance.now();
    let budget = MAX_FX_EVENTS;

    const start = Math.max(0, events.length - 200);
    for (let index = start; index < events.length && budget > 0; index += 1) {
      const event = events[index];
      if (!event) {
        continue;
      }
      const delay = span > 1 && sameWave
        ? Math.max(0, Math.min(1, (event.tick - this.lastWaveTick - 1) / span)) * glideMs
        : 0;

      switch (event.type) {
        case "tower-hit": {
          const tower = this.towerVisuals.get(event.towerId);
          const creature = this.creatureVisuals.get(event.creatureId);
          if (tower && creature) {
            const color = colorForPlayer(event.playerId);
            fx.projectile(tower.baseX, tower.baseY, creature.curX * cellSize, creature.curY * cellSize, color, delay);
            tower.recoilUntil = now + delay + RECOIL_MS;
            budget -= 1;
          }
          break;
        }
        case "creature-defeated": {
          const creature = this.creatureVisuals.get(event.creatureId);
          if (creature) {
            const x = creature.curX * cellSize;
            const y = creature.curY * cellSize;
            const color = colorForPlayer(event.playerId);
            fx.puff(x, y, 0xd9d2c0, delay + 120);
            fx.burst(x, y, color, delay + 120);
            fx.floatText(x, y - cellSize * 0.5, `+${event.rewardPoints}`, color, delay + 120);
            budget -= 1;
          }
          break;
        }
        case "creature-attack": {
          const tower = this.towerVisuals.get(event.targetTowerId);
          if (tower) {
            tower.flashUntil = now + delay + FLASH_MS;
            tower.shakeUntil = now + delay + SHAKE_MS;
            fx.spark(tower.baseX, tower.baseY, 0xff7a66, delay);
            budget -= 1;
          }
          break;
        }
        case "tower-destroyed": {
          const tower = this.towerVisuals.get(event.towerId);
          if (tower) {
            fx.smoke(tower.baseX, tower.baseY, delay);
            fx.puff(tower.baseX, tower.baseY, 0xd9d2c0, delay);
            budget -= 1;
          }
          break;
        }
        case "wall-hit": {
          const wall = this.wallVisuals.get(event.targetWallId);
          if (wall) {
            fx.spark(wall.image.x, wall.image.y, 0xf3ead6, delay);
            budget -= 1;
          }
          break;
        }
        case "wall-destroyed": {
          const wall = this.wallVisuals.get(event.wallId);
          if (wall) {
            fx.puff(wall.image.x, wall.image.y, 0xbdb5a6, delay);
            budget -= 1;
          }
          break;
        }
        default:
          break;
      }
    }
  }
}

export interface BattlefieldMountOptions {
  onCellClick?: (x: number, y: number) => void;
}

export interface BattlefieldMount {
  renderMap(snapshot: MatchSnapshot | null, transitionMs?: number, events?: MatchEvent[]): void;
  creaturePositions(): Array<{ id: string; x: number; y: number }>;
  cellToCss(x: number, y: number): { x: number; y: number };
  cellSize(): number;
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
    scene: [],
    render: { antialias: true }
  });

  const scene = new BattlefieldScene();
  scene.setOnCellClick(options.onCellClick);
  game.scene.add("battlefield", scene, true);

  return {
    renderMap(snapshot: MatchSnapshot | null, transitionMs = 0, events: MatchEvent[] = []): void {
      scene?.renderSnapshot(snapshot, transitionMs, events);
    },
    creaturePositions(): Array<{ id: string; x: number; y: number }> {
      return scene.creaturePositions();
    },
    cellToCss(x: number, y: number): { x: number; y: number } {
      return scene.cellToCss(x, y);
    },
    cellSize(): number {
      return scene.getCellSize();
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
