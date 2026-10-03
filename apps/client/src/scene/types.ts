import type Phaser from "phaser";

import type { CreatureArchetype, DamageType, MatchPhase, TowerUpgrades } from "@tower-defense/shared";

import type { RuinInfo } from "../ruins";

export interface PlacementContext {
  phase: MatchPhase;
  playerId: string;
  hasTowerAlready: boolean;
  // Moving the tower: the ghost tower is shown even though the player already has one.
  moveMode?: boolean;
}

export interface TowerVisual {
  container: Phaser.GameObjects.Container;
  base: Phaser.GameObjects.Image;
  turret: Phaser.GameObjects.Image;
  pips: Phaser.GameObjects.Image;
  hpBg: Phaser.GameObjects.Image;
  hpFill: Phaser.GameObjects.Image;
  flash: Phaser.GameObjects.Image;
  player: number;
  level: number;
  tier: number;
  upgrades: TowerUpgrades;
  damageType: DamageType;
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

export interface CreatureVisual {
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

export interface RuinVisual extends RuinInfo {
  image: Phaser.GameObjects.Image;
}

export interface PendingDeath {
  delayMs: number;
  info: RuinInfo;
}
