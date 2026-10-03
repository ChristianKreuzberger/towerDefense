export interface AudioSettings {
    effectsVolume: number;
    muted: boolean;
}
export interface StorageLike {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
}
export declare const DEFAULT_AUDIO_SETTINGS: Readonly<AudioSettings>;
export declare const SETTINGS_STORAGE_KEY = "towerDefense.settings.v1";
export declare function clampVolume(value: unknown): number;
export declare function parseSettings(raw: string | null): AudioSettings;
export declare function serializeSettings(settings: AudioSettings): string;
export interface SettingsStore {
    get(): AudioSettings;
    set(patch: Partial<AudioSettings>): void;
    subscribe(listener: (settings: AudioSettings) => void): () => void;
    effectiveGain(): number;
}
export declare function createSettingsStore(storage?: StorageLike | null): SettingsStore;
//# sourceMappingURL=settings.d.ts.map