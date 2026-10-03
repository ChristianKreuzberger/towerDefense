import { PLAYBACK_SPEEDS } from "./constants";
interface PlaybackHooks {
    advance(ticks: number): Promise<void>;
    blocked(): boolean;
}
export declare function configurePlayback(next: PlaybackHooks): void;
export declare function msPerTick(): number;
export declare function playbackShouldRun(): boolean;
export declare function startPlayback(): void;
export declare function stopPlayback(): void;
export declare function playbackStep(): void;
export declare function setPlaying(next: boolean): void;
export declare function setPlaybackSpeed(next: (typeof PLAYBACK_SPEEDS)[number]): void;
export declare function syncPlaybackControls(): void;
export {};
//# sourceMappingURL=playback.d.ts.map