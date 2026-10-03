import type { MatchEvent, MatchSnapshot } from "@tower-defense/shared";

import type { Effects } from "../art/fx";
import { colorForPlayer } from "../art/palette";
import { ownerNameFor } from "../ruins";
import type { CreatureVisual, PendingDeath, TowerVisual } from "./types";

// Bounds the work one snapshot can cause even if a long batch (or a reconnect) delivers hundreds of events.
const MAX_FX_EVENTS = 40;
export const FLASH_MS = 200;
export const SHAKE_MS = 220;
export const RECOIL_MS = 140;

export interface FxContext {
  fx: Effects | undefined;
  cellSize: number;
  lastWave: number;
  lastWaveTick: number;
  towerVisuals: Map<string, TowerVisual>;
  creatureVisuals: Map<string, CreatureVisual>;
  pendingDeaths: Map<string, PendingDeath>;
}

export function playEvents(ctx: FxContext, events: MatchEvent[], snapshot: MatchSnapshot, glideMs: number): void {
  const fx = ctx.fx;
  if (!fx || events.length === 0) {
    return;
  }
  const cellSize = ctx.cellSize;
  const sameWave = snapshot.wave === ctx.lastWave;
  const span = sameWave ? Math.max(1, snapshot.waveTick - ctx.lastWaveTick) : 1;
  const now = performance.now();
  let budget = MAX_FX_EVENTS;

  const start = Math.max(0, events.length - 200);
  for (let index = start; index < events.length && budget > 0; index += 1) {
    const event = events[index];
    if (!event) {
      continue;
    }
    const delay = span > 1 && sameWave
      ? Math.max(0, Math.min(1, (event.tick - ctx.lastWaveTick - 1) / span)) * glideMs
      : 0;

    switch (event.type) {
      case "tower-hit": {
        const tower = ctx.towerVisuals.get(event.towerId);
        const creature = ctx.creatureVisuals.get(event.creatureId);
        if (tower) {
          const color = colorForPlayer(event.playerId);
          const x = creature ? creature.curX * cellSize : (event.x + 0.5) * cellSize;
          const y = creature ? creature.curY * cellSize : (event.y + 0.5) * cellSize;
          fx.projectile(tower.baseX, tower.baseY, x, y, color, delay, tower.tier);
          tower.recoilUntil = now + delay + RECOIL_MS;
          budget -= 1;
        }
        break;
      }
      case "tower-miss": {
        const tower = ctx.towerVisuals.get(event.towerId);
        const creature = ctx.creatureVisuals.get(event.creatureId);
        if (tower) {
          const color = colorForPlayer(event.playerId);
          const x = creature ? creature.curX * cellSize : (event.x + 0.5) * cellSize;
          const y = creature ? creature.curY * cellSize : (event.y + 0.5) * cellSize;
          // The shot flies past the creature, offset sideways so a miss is visibly different from a hit.
          const dx = x - tower.baseX;
          const dy = y - tower.baseY;
          const length = Math.max(1, Math.hypot(dx, dy));
          const missX = x + (-dy / length) * cellSize * 0.9;
          const missY = y + (dx / length) * cellSize * 0.9;
          fx.projectile(tower.baseX, tower.baseY, missX, missY, color, delay, tower.tier);
          fx.floatText(x, y - cellSize * 0.5, "miss", 0xcfc8b8, delay + 120);
          tower.recoilUntil = now + delay + RECOIL_MS;
          budget -= 1;
        }
        break;
      }
      case "creature-defeated": {
        const creature = ctx.creatureVisuals.get(event.creatureId);
        const x = creature ? creature.curX * cellSize : (event.x + 0.5) * cellSize;
        const y = creature ? creature.curY * cellSize : (event.y + 0.5) * cellSize;
        const color = colorForPlayer(event.playerId);
        fx.puff(x, y, 0xd9d2c0, delay + 120);
        fx.burst(x, y, color, delay + 120);
        fx.floatText(x, y - cellSize * 0.5, `+${event.rewardPoints}`, color, delay + 120);
        budget -= 1;
        break;
      }
      case "creature-attack": {
        const tower = ctx.towerVisuals.get(event.targetTowerId);
        if (tower) {
          tower.flashUntil = now + delay + FLASH_MS;
          tower.shakeUntil = now + delay + SHAKE_MS;
          fx.spark(tower.baseX, tower.baseY, 0xff7a66, delay);
          budget -= 1;
        }
        break;
      }
      case "tower-destroyed": {
        const tower = ctx.towerVisuals.get(event.towerId);
        if (tower) {
          fx.explosion(tower.baseX, tower.baseY, delay);
          ctx.pendingDeaths.set(event.towerId, {
            delayMs: delay,
            info: { ownerName: ownerNameFor(snapshot.players, event.playerId), wave: event.wave }
          });
          budget -= 1;
        }
        break;
      }
      default:
        break;
    }
  }
}
