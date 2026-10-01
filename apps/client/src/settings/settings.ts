export interface AudioSettings {
  effectsVolume: number;
  muted: boolean;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const DEFAULT_AUDIO_SETTINGS: Readonly<AudioSettings> = Object.freeze({ effectsVolume: 0.7, muted: false });
export const SETTINGS_STORAGE_KEY = "towerDefense.settings.v1";

export function clampVolume(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_AUDIO_SETTINGS.effectsVolume;
  }
  return Math.min(1, Math.max(0, value));
}

// Field-wise fallback so one bad field never throws away the user's other choices.
export function parseSettings(raw: string | null): AudioSettings {
  let parsed: unknown = null;
  if (raw !== null) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }
  }
  const record = typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  return {
    effectsVolume: clampVolume(record.effectsVolume),
    muted: typeof record.muted === "boolean" ? record.muted : DEFAULT_AUDIO_SETTINGS.muted
  };
}

export function serializeSettings(settings: AudioSettings): string {
  return JSON.stringify({ version: 1, effectsVolume: settings.effectsVolume, muted: settings.muted });
}

export interface SettingsStore {
  get(): AudioSettings;
  set(patch: Partial<AudioSettings>): void;
  subscribe(listener: (settings: AudioSettings) => void): () => void;
  effectiveGain(): number;
}

function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    // Accessing localStorage itself throws when site data is blocked.
    return null;
  }
}

export function createSettingsStore(storage: StorageLike | null = defaultStorage()): SettingsStore {
  let raw: string | null = null;
  try {
    raw = storage?.getItem(SETTINGS_STORAGE_KEY) ?? null;
  } catch {
    raw = null;
  }
  let settings = parseSettings(raw);
  const listeners = new Set<(settings: AudioSettings) => void>();

  return {
    get: () => ({ ...settings }),
    set(patch) {
      settings = {
        effectsVolume: patch.effectsVolume === undefined ? settings.effectsVolume : clampVolume(patch.effectsVolume),
        muted: patch.muted === undefined ? settings.muted : patch.muted === true
      };
      try {
        storage?.setItem(SETTINGS_STORAGE_KEY, serializeSettings(settings));
      } catch {
        // Settings stay in memory for this session.
      }
      for (const listener of [...listeners]) {
        listener({ ...settings });
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    effectiveGain: () => (settings.muted ? 0 : settings.effectsVolume)
  };
}
