import {
  CREATURE_ARCHETYPE_STATS,
  CREATURE_PROXIMITY_DAMAGE_BANDS,
  DAMAGE_TYPES,
  MAX_TOWER_LEVEL,
  UPGRADE_TRACKS,
  getDamageAgainst,
  getDamageMultiplier,
  getTowerAccuracy,
  getTowerDamage,
  getTowerRange,
  getTowerUpgradeCost,
  getWaveComposition,
  isValidTowerPlacement,
  type AiDifficulty,
  type DamageType,
  type GameMap,
  type MatchSnapshot,
  type PlayerState,
  type SimulationCommand,
  type Tower,
  type TowerTargetMode,
  type UpgradeTrack
} from "@tower-defense/shared";
import type { MatchSimulation } from "./match-simulation.js";
import { getOpenPathForCreatures } from "./path-utils.js";
import { rollShot } from "./shot-roll.js";

// Bots decide from a snapshot alone (what a human sees) and answer with ordinary commands, so every rule and rejection
// applies to them. Nothing here touches simulation state, tick order or the match RNG: with the same snapshot the
// planner gives the same answer, and a match without bots never reaches this file.

// Cells a creature of the longest reach can hit; towers closer to the lane than this take damage.
const DANGER_DISTANCE = Math.max(...CREATURE_PROXIMITY_DAMAGE_BANDS.map((band) => band.maxDistance));
// Hard bots only spend their free move on a clearly better spot.
const MOVE_SCORE_MARGIN = 5;
// Chance that an easy bot saves its points instead of buying in a given prep.
const EASY_SAVE_CHANCE = 0.3;
// Medium buys the cheapest-to-level track first in this order when levels tie.
const MEDIUM_TRACK_PRIORITY: readonly UpgradeTrack[] = ["accuracy", "damage", "range"];

// Deterministic 0..1 value that depends only on the match seed, wave, the player and a salt for repeated draws.
function aiRoll(snapshot: MatchSnapshot, playerId: string, salt: number): number {
  return rollShot(snapshot.map.seed, snapshot.wave, salt, `ai-${playerId}`);
}

interface Spot {
  x: number;
  y: number;
}

function laneCells(map: GameMap): Spot[] {
  return map.cells.filter((cell) => cell.buildable);
}

function laneCoverage(lane: readonly Spot[], spot: Spot, range: number): number {
  let covered = 0;
  for (const cell of lane) {
    if (Math.hypot(cell.x - spot.x, cell.y - spot.y) <= range) {
      covered += 1;
    }
  }
  return covered;
}

function proximityMultiplier(distance: number): number {
  const band = CREATURE_PROXIMITY_DAMAGE_BANDS.find((entry) => distance <= entry.maxDistance);
  return band ? band.multiplier : 0;
}

// Hard values the early part of the route more: a creature that dies upstream never reaches the towers behind, and
// the points go to whoever lands the killing shot.
const EARLY_ROUTE_BONUS = 1;
// Medium notices it too, but only a little.
const MEDIUM_EARLY_ROUTE_BONUS = 0.15;
const HARD_EXPOSURE_WEIGHT = 1;

function earlyWeightedCoverage(route: readonly Spot[], spot: Spot, range: number, earlyBonus: number): number {
  let weighted = 0;
  route.forEach((cell, index) => {
    if (Math.hypot(cell.x - spot.x, cell.y - spot.y) <= range) {
      weighted += 1 + earlyBonus * (1 - index / route.length);
    }
  });
  return weighted;
}

// Lane cells in reach, with the damage band weighting from the creature attack rules: a spot beside the road shoots a
// lot of road but is also hit hard by everything that walks past.
function scoreSpot(lane: readonly Spot[], route: readonly Spot[], spot: Spot, difficulty: AiDifficulty): number {
  let exposure = 0;
  let nearest = Infinity;
  for (const cell of lane) {
    const distance = Math.hypot(cell.x - spot.x, cell.y - spot.y);
    nearest = Math.min(nearest, distance);
    if (distance <= DANGER_DISTANCE) {
      exposure += proximityMultiplier(distance);
    }
  }
  if (difficulty === "hard") {
    return earlyWeightedCoverage(route, spot, getTowerRange(1), EARLY_ROUTE_BONUS) - HARD_EXPOSURE_WEIGHT * exposure;
  }
  // Medium only knows "do not stand right next to the road".
  return earlyWeightedCoverage(route, spot, getTowerRange(1), MEDIUM_EARLY_ROUTE_BONUS) - (nearest <= DANGER_DISTANCE ? 10 : 0);
}

function rankSpots(
  snapshot: MatchSnapshot,
  playerId: string,
  difficulty: AiDifficulty,
  towers: readonly Tower[]
): Array<Spot & { score: number }> {
  const lane = laneCells(snapshot.map);
  const route = getOpenPathForCreatures(snapshot.map, [...towers]);
  const ranked: Array<Spot & { score: number }> = [];
  snapshot.map.towerSpots.forEach((spot, index) => {
    const placement = { playerId, x: spot.x, y: spot.y };
    if (!isValidTowerPlacement(placement, [...towers], snapshot.map).valid) {
      return;
    }
    const score = difficulty === "easy" ? aiRoll(snapshot, playerId, 1000 + index) : scoreSpot(lane, route, spot, difficulty);
    ranked.push({ x: spot.x, y: spot.y, score });
  });
  return ranked.sort((a, b) => b.score - a.score || a.y - b.y || a.x - b.x);
}

function expectedDamageRate(lane: readonly Spot[], tower: Tower, upgrades: Tower["upgrades"]): number {
  return getTowerAccuracy(upgrades.accuracy) * getTowerDamage(upgrades.damage)
    * laneCoverage(lane, tower, getTowerRange(upgrades.range));
}

function chooseUpgrade(
  snapshot: MatchSnapshot,
  player: PlayerState,
  tower: Tower,
  difficulty: AiDifficulty
): UpgradeTrack | null {
  const affordable = UPGRADE_TRACKS.filter((track) => {
    const level = tower.upgrades[track];
    return level < MAX_TOWER_LEVEL && getTowerUpgradeCost(track, level) <= player.points;
  });
  if (affordable.length === 0) {
    return null;
  }

  if (difficulty === "easy") {
    const purchases = UPGRADE_TRACKS.reduce((sum, track) => sum + tower.upgrades[track] - 1, 0);
    if (aiRoll(snapshot, player.id, 2000) < EASY_SAVE_CHANCE) {
      return null;
    }
    const pick = Math.floor(aiRoll(snapshot, player.id, 3000 + purchases) * affordable.length);
    return affordable[Math.min(pick, affordable.length - 1)] ?? null;
  }

  if (difficulty === "medium") {
    return [...affordable].sort(
      (a, b) => tower.upgrades[a] - tower.upgrades[b]
        || MEDIUM_TRACK_PRIORITY.indexOf(a) - MEDIUM_TRACK_PRIORITY.indexOf(b)
    )[0] ?? null;
  }

  // Hard: the best gain in expected damage per point spent.
  const lane = laneCells(snapshot.map);
  const baseline = expectedDamageRate(lane, tower, tower.upgrades);
  let best: { track: UpgradeTrack; value: number } | null = null;
  for (const track of affordable) {
    const next = { ...tower.upgrades, [track]: tower.upgrades[track] + 1 };
    const gain = expectedDamageRate(lane, tower, next) - baseline;
    const value = gain / getTowerUpgradeCost(track, tower.upgrades[track]);
    if (!best || value > best.value) {
      best = { track, value };
    }
  }
  return best?.track ?? null;
}

function chooseDamageType(snapshot: MatchSnapshot, tower: Tower, difficulty: AiDifficulty): DamageType {
  const composition = getWaveComposition(snapshot.wave);
  if (difficulty === "medium") {
    // The type that is strongest against the most numerous archetype of the next wave.
    const majority = [...composition].sort((a, b) => b.count - a.count)[0];
    if (!majority) {
      return tower.damageType;
    }
    return [...DAMAGE_TYPES].sort(
      (a, b) => getDamageMultiplier(majority.archetype, b) - getDamageMultiplier(majority.archetype, a)
    )[0] ?? tower.damageType;
  }

  // Hard: reward points per tower damage over the whole wave, using the real rounding at the current damage level.
  const damage = getTowerDamage(tower.upgrades.damage);
  let best: { type: DamageType; value: number } | null = null;
  for (const type of DAMAGE_TYPES) {
    let value = 0;
    for (const entry of composition) {
      const stats = CREATURE_ARCHETYPE_STATS[entry.archetype];
      value += entry.count * stats.rewardPoints * getDamageAgainst(damage, type, entry.archetype) / stats.hp;
    }
    if (!best || value > best.value) {
      best = { type, value };
    }
  }
  return best?.type ?? tower.damageType;
}

function chooseTargetMode(snapshot: MatchSnapshot, tower: Tower, difficulty: AiDifficulty): TowerTargetMode {
  if (difficulty !== "hard") {
    return "first";
  }
  if (tower.health * 2 < tower.maxHealth) {
    return "nearest";
  }
  const composition = getWaveComposition(snapshot.wave);
  return composition.some((entry) => entry.archetype === "tank" || entry.archetype === "armored") ? "strongest" : "first";
}

// Alternatives for the bot's next step, best first: the host applies the first one the rules accept. Placement is the
// only step with several alternatives (a spot can be rejected for reasons the planner cannot see, such as the lane
// check). An empty list means nothing is left to do but ready up.
export function planAiCommands(snapshot: MatchSnapshot, playerId: string, difficulty: AiDifficulty): SimulationCommand[] {
  const player = snapshot.players.find((entry) => entry.id === playerId);
  if (!player || snapshot.phase !== "placement" || player.eliminated || player.readyForWave) {
    return [];
  }

  const tower = snapshot.towers.find((entry) => entry.playerId === playerId);
  if (!tower) {
    return rankSpots(snapshot, playerId, difficulty, snapshot.towers)
      .map((spot) => ({ type: "place-tower", playerId, x: spot.x, y: spot.y }));
  }

  if (difficulty === "hard" && player.towerMoveAvailable) {
    const others = snapshot.towers.filter((entry) => entry.id !== tower.id);
    const lane = laneCells(snapshot.map);
    const current = scoreSpot(lane, getOpenPathForCreatures(snapshot.map, others), tower, "hard");
    const better = rankSpots(snapshot, playerId, "hard", others)
      .filter((spot) => (spot.x !== tower.x || spot.y !== tower.y) && spot.score >= current + MOVE_SCORE_MARGIN);
    if (better.length > 0) {
      return better.map((spot) => ({ type: "move-tower", playerId, towerId: tower.id, x: spot.x, y: spot.y }));
    }
  }

  if (difficulty !== "easy") {
    const damageType = chooseDamageType(snapshot, tower, difficulty);
    if (damageType !== tower.damageType) {
      return [{ type: "set-damage-type", playerId, towerId: tower.id, damageType }];
    }
    const mode = chooseTargetMode(snapshot, tower, difficulty);
    if (mode !== tower.targetMode) {
      return [{ type: "set-target-mode", playerId, towerId: tower.id, mode }];
    }
  }

  const track = chooseUpgrade(snapshot, player, tower, difficulty);
  if (track) {
    return [{ type: "upgrade-tower", playerId, towerId: tower.id, track }];
  }
  return [];
}

export interface AiAction {
  playerId: string;
  command: SimulationCommand;
  accepted: boolean;
}

export interface AiStepResult {
  action: AiAction | null;
  // True while a bot still has something to do in this prep (so the caller should step again).
  pending: boolean;
}

function nextBot(snapshot: MatchSnapshot): PlayerState | undefined {
  return snapshot.players.find((player) => player.ai && !player.eliminated && !player.readyForWave);
}

// Bots wait for the humans to place first, so humans keep the free choice of spots.
function canBotsAct(snapshot: MatchSnapshot): boolean {
  return snapshot.phase === "placement"
    && snapshot.players.every((player) => player.ai || player.eliminated || player.hasPlacedTower);
}

export function areBotsPending(snapshot: MatchSnapshot): boolean {
  return canBotsAct(snapshot) && nextBot(snapshot) !== undefined;
}

// Applies one command for the next bot in id order. One command per call lets the caller pace the bots (see spec/02).
export function stepAiPlayers(simulation: MatchSimulation): AiStepResult {
  const snapshot = simulation.getSnapshot();
  const bot = areBotsPending(snapshot) ? nextBot(snapshot) : undefined;
  if (!bot?.ai) {
    return { action: null, pending: false };
  }

  for (const command of planAiCommands(snapshot, bot.id, bot.ai)) {
    if (simulation.applyCommand(command).accepted) {
      return { action: { playerId: bot.id, command, accepted: true }, pending: true };
    }
  }

  // Nothing (more) to do, or every alternative was rejected: commit, so a stuck bot can never block the wave.
  const ready: SimulationCommand = { type: "ready-for-wave", playerId: bot.id };
  const accepted = simulation.applyCommand(ready).accepted;
  return {
    action: { playerId: bot.id, command: ready, accepted },
    pending: accepted && areBotsPending(simulation.getSnapshot())
  };
}
