import type { MatchEvent, MatchSnapshot } from "@tower-defense/shared";

export type SoundId =
  | "tower-shot"
  | "creature-kill"
  | "cannon-shot"
  | "frost-shot"
  | "cannon-splash"
  | "creature-split"
  | "boss-hit"
  | "boss-spawn"
  | "boss-defeated"
  | "tower-damaged"
  | "tower-destroyed"
  | "wave-start"
  | "wave-clear"
  | "wave-clear-bonus"
  | "repair"
  | "win"
  | "lose"
  | "place-tower"
  | "upgrade"
  | "ready"
  | "rejected"
  | "ui-click";

export interface SoundCue {
  id: SoundId;
  playerNumber?: number;
  intensity?: number;
}

const MAX_SHOTS_PER_SNAPSHOT = 4;
const MAX_KILLS_PER_SNAPSHOT = 3;
// More shots than this in one snapshot means a busy wave: each one is played quieter so the mix stays soft.
const BUSY_SHOT_COUNT = 2;
const BUSY_SHOT_INTENSITY = 0.7;
const SHOT_IDS: ReadonlySet<SoundId> = new Set(["tower-shot", "cannon-shot", "frost-shot"]);

export function playerNumberOf(playerId: string): number {
  return Number(playerId.replace(/\D+/g, "")) || 1;
}

export interface SnapshotChange {
  previous: MatchSnapshot | null;
  next: MatchSnapshot;
  events: readonly MatchEvent[];
  suppress: boolean;
}

export function cuesForSnapshotChange({ previous, next, events, suppress }: SnapshotChange): SoundCue[] {
  // A fresh load or backlog replays history; sounding it would be noise.
  if (previous === null || suppress) {
    return [];
  }

  const cues: SoundCue[] = [];
  const shotTowers = new Set<string>();
  let kills = 0;
  let waveStartSeen = false;
  let repaired = false;
  const towerOwner = new Map(next.towers.map((tower) => [tower.id, tower.playerId]));
  const towerType = new Map(next.towers.map((tower) => [tower.id, tower.towerType]));
  // Events do not carry the archetype of a hit or killed creature; it comes from the snapshots and spawn events.
  const bossIds = new Set<string>();
  for (const creature of [...(previous.creatures ?? []), ...(next.creatures ?? [])]) {
    if (creature.archetype === "juggernaut") {
      bossIds.add(creature.id);
    }
  }
  for (const event of events) {
    if (event.type === "creature-spawned" && event.archetype === "juggernaut") {
      bossIds.add(event.creatureId);
    }
  }
  let bossSpawnSeen = false;
  let bossHitSeen = false;
  let splashSeen = false;
  let splitSeen = false;

  for (const event of events) {
    switch (event.type) {
      case "tower-hit":
      case "tower-miss":
        if (event.type === "tower-hit" && event.splash) {
          // Extra hits of a cannon blast share one dull boom instead of one cue each.
          if (!splashSeen) {
            splashSeen = true;
            cues.push({ id: "cannon-splash" });
          }
          break;
        }
        if (event.type === "tower-hit" && bossIds.has(event.creatureId) && !bossHitSeen) {
          bossHitSeen = true;
          cues.push({ id: "boss-hit" });
        }
        if (!shotTowers.has(event.towerId) && shotTowers.size < MAX_SHOTS_PER_SNAPSHOT) {
          shotTowers.add(event.towerId);
          const type = towerType.get(event.towerId);
          const id: SoundId = type === "cannon" ? "cannon-shot" : type === "frost" ? "frost-shot" : "tower-shot";
          cues.push({ id, playerNumber: playerNumberOf(event.playerId) });
        }
        break;
      case "creature-spawned":
        if (event.archetype === "juggernaut" && !bossSpawnSeen) {
          bossSpawnSeen = true;
          cues.push({ id: "boss-spawn" });
        }
        break;
      case "creature-split":
        if (!splitSeen) {
          splitSeen = true;
          cues.push({ id: "creature-split" });
        }
        break;
      case "creature-defeated":
        if (bossIds.has(event.creatureId)) {
          cues.push({ id: "boss-defeated", playerNumber: playerNumberOf(event.playerId) });
        } else if (kills < MAX_KILLS_PER_SNAPSHOT) {
          kills += 1;
          cues.push({ id: "creature-kill", playerNumber: playerNumberOf(event.playerId) });
        }
        break;
      case "creature-attack": {
        const owner = towerOwner.get(event.targetTowerId);
        cues.push(owner === undefined ? { id: "tower-damaged" } : { id: "tower-damaged", playerNumber: playerNumberOf(owner) });
        break;
      }
      case "tower-destroyed":
        cues.push({ id: "tower-destroyed", playerNumber: playerNumberOf(event.playerId) });
        break;
      case "wave-start":
        if (!waveStartSeen) {
          waveStartSeen = true;
          cues.push({ id: "wave-start" });
        }
        break;
      case "wave-end":
        cues.push({ id: "wave-clear" }, { id: "wave-clear-bonus" });
        break;
      case "tower-repaired":
        if (!repaired) {
          repaired = true;
          cues.push({ id: "repair" });
        }
        break;
      default:
        break;
    }
  }

  const shotCount = cues.filter((cue) => SHOT_IDS.has(cue.id)).length;
  if (shotCount > BUSY_SHOT_COUNT) {
    for (const cue of cues) {
      if (SHOT_IDS.has(cue.id)) {
        cue.intensity = BUSY_SHOT_INTENSITY;
      }
    }
  }

  if (!waveStartSeen && previous.phase !== "wave" && next.phase === "wave") {
    cues.push({ id: "wave-start" });
  }

  if (previous.phase !== "ended" && next.phase === "ended") {
    if (next.endReason === "score-win") {
      cues.push({ id: "win" });
    } else if (next.endReason === "all-towers-destroyed") {
      cues.push({ id: "lose" });
    }
  }

  return cues;
}

export function cueForCommandResult(commandType: string, accepted: boolean): SoundCue | null {
  const cues: Record<string, SoundId> = {
    "place-tower": "place-tower",
    "move-tower": "place-tower",
    "upgrade-tower": "upgrade",
    "ready-for-wave": "ready"
  };
  const id = cues[commandType];
  if (id === undefined) {
    return null;
  }
  return { id: accepted ? id : "rejected" };
}
