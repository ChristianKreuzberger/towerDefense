export interface AudioSettings {
  effectsVolume: number;
  muted: boolean;
  // Optional visual extras (hit sparks, big-kill glow, wave and boss banners). Essential cues always show.
  effects: boolean;
  // Procedural background music: off by default, with its own volume.
  musicEnabled: boolean;
  musicVolume: number;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const DEFAULT_AUDIO_SETTINGS: Readonly<AudioSettings> = Object.freeze({ effectsVolume: 0.7, muted: false, effects: true, musicEnabled: false, musicVolume: 0.4 });
export const SETTINGS_STORAGE_KEY = "towerDefense.settings.v1";

export function clampVolume(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_AUDIO_SETTINGS.effectsVolume;
  }
  return Math.min(1, Math.max(0, value));
}

function clampMusicVolume(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : DEFAULT_AUDIO_SETTINGS.musicVolume;
}

function isValidVolume(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
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
    // Out-of-range stored values are invalid per the schema, so they fall back instead of clamping.
    effectsVolume: isValidVolume(record.effectsVolume) ? record.effectsVolume : DEFAULT_AUDIO_SETTINGS.effectsVolume,
    muted: typeof record.muted === "boolean" ? record.muted : DEFAULT_AUDIO_SETTINGS.muted,
    effects: typeof record.effects === "boolean" ? record.effects : DEFAULT_AUDIO_SETTINGS.effects,
    musicEnabled: typeof record.musicEnabled === "boolean" ? record.musicEnabled : DEFAULT_AUDIO_SETTINGS.musicEnabled,
    musicVolume: isValidVolume(record.musicVolume) ? record.musicVolume : DEFAULT_AUDIO_SETTINGS.musicVolume
  };
}

export function serializeSettings(settings: AudioSettings): string {
  return JSON.stringify({ version: 1, effectsVolume: settings.effectsVolume, muted: settings.muted, effects: settings.effects,
    musicEnabled: settings.musicEnabled,
    musicVolume: settings.musicVolume
  });
}

export interface SettingsStore {
  get(): AudioSettings;
  set(patch: Partial<AudioSettings>): void;
  subscribe(listener: (settings: AudioSettings) => void): () => void;
  effectiveGain(): number;
  // 0 when muted or music is off, so one check decides whether music may sound at all.
  effectiveMusicGain(): number;
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
        muted: patch.muted === undefined ? settings.muted : patch.muted === true,
        effects: patch.effects === undefined ? settings.effects : patch.effects === true,
        musicEnabled: patch.musicEnabled === undefined ? settings.musicEnabled : patch.musicEnabled === true,
        musicVolume: patch.musicVolume === undefined ? settings.musicVolume : clampMusicVolume(patch.musicVolume)
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
    effectiveGain: () => (settings.muted ? 0 : settings.effectsVolume),
    effectiveMusicGain: () => (settings.muted || !settings.musicEnabled ? 0 : settings.musicVolume)
  };
}
