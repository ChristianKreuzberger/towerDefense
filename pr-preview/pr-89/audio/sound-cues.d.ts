import type { MatchEvent, MatchSnapshot } from "@tower-defense/shared";
export type SoundId = "tower-shot" | "creature-kill" | "tower-damaged" | "tower-destroyed" | "wave-start" | "wave-clear" | "wave-clear-bonus" | "repair" | "win" | "lose" | "place-tower" | "upgrade" | "ready" | "rejected" | "ui-click";
export interface SoundCue {
    id: SoundId;
    playerNumber?: number;
    intensity?: number;
}
export declare function playerNumberOf(playerId: string): number;
export interface SnapshotChange {
    previous: MatchSnapshot | null;
    next: MatchSnapshot;
    events: readonly MatchEvent[];
    suppress: boolean;
}
export declare function cuesForSnapshotChange({ previous, next, events, suppress }: SnapshotChange): SoundCue[];
export declare function cueForCommandResult(commandType: string, accepted: boolean): SoundCue | null;
//# sourceMappingURL=sound-cues.d.ts.map