import type { SettingsStore } from "../settings/settings.js";
import type { SoundCue } from "./sound-cues.js";
export interface SoundEngine {
    /** Creates the context on first call and resumes it; must run inside a user gesture. */
    unlock(): void;
    /** Starts listening for the first user gesture and stops once audio is running. */
    bindUnlock(target: EventTarget): void;
    play(cue: SoundCue, delayMs?: number): void;
    /** Spreads cues across glideMs so one batched response does not fire all at once. */
    playCues(cues: readonly SoundCue[], glideMs: number): void;
    previewVolume(): void;
}
export interface SoundEngineOptions {
    settings: SettingsStore;
    createContext?: () => AudioContext | null;
    now?: () => number;
    isHidden?: () => boolean;
    /** Where `visibilitychange` is observed; defaults to `document`. */
    visibilityTarget?: EventTarget | undefined;
}
export declare function createSoundEngine(options: SoundEngineOptions): SoundEngine;
//# sourceMappingURL=sound-engine.d.ts.map