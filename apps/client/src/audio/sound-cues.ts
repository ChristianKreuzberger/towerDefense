import type { MatchEvent, MatchSnapshot } from "@tower-defense/shared";

export type SoundId =
  | "tower-shot"
  | "creature-kill"
  | "tower-damaged"
  | "tower-destroyed"
  | "wall-hit"
  | "wall-destroyed"
  | "wave-start"
  | "wave-clear"
  | "wave-clear-bonus"
  | "repair"
  | "win"
  | "lose"
  | "place-tower"
  | "place-wall"
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

  for (const event of events) {
    switch (event.type) {
      case "tower-hit":
      case "tower-miss":
        if (!shotTowers.has(event.towerId) && shotTowers.size < MAX_SHOTS_PER_SNAPSHOT) {
          shotTowers.add(event.towerId);
          cues.push({ id: "tower-shot", playerNumber: playerNumberOf(event.playerId) });
        }
        break;
      case "creature-defeated":
        if (kills < MAX_KILLS_PER_SNAPSHOT) {
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
      case "wall-hit":
        cues.push({ id: "wall-hit" });
        break;
      case "wall-destroyed":
        cues.push({ id: "wall-destroyed" });
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
    "place-wall": "place-wall",
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
