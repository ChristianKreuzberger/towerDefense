export const DEFAULT_AUDIO_SETTINGS = Object.freeze({ effectsVolume: 0.7, muted: false });
export const SETTINGS_STORAGE_KEY = "towerDefense.settings.v1";
export function clampVolume(value) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        return DEFAULT_AUDIO_SETTINGS.effectsVolume;
    }
    return Math.min(1, Math.max(0, value));
}
function isValidVolume(value) {
    return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}
// Field-wise fallback so one bad field never throws away the user's other choices.
export function parseSettings(raw) {
    let parsed = null;
    if (raw !== null) {
        try {
            parsed = JSON.parse(raw);
        }
        catch {
            parsed = null;
        }
    }
    const record = typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed : {};
    return {
        // Out-of-range stored values are invalid per the schema, so they fall back instead of clamping.
        effectsVolume: isValidVolume(record.effectsVolume) ? record.effectsVolume : DEFAULT_AUDIO_SETTINGS.effectsVolume,
        muted: typeof record.muted === "boolean" ? record.muted : DEFAULT_AUDIO_SETTINGS.muted
    };
}
export function serializeSettings(settings) {
    return JSON.stringify({ version: 1, effectsVolume: settings.effectsVolume, muted: settings.muted });
}
function defaultStorage() {
    try {
        return typeof localStorage === "undefined" ? null : localStorage;
    }
    catch {
        // Accessing localStorage itself throws when site data is blocked.
        return null;
    }
}
export function createSettingsStore(storage = defaultStorage()) {
    let raw = null;
    try {
        raw = storage?.getItem(SETTINGS_STORAGE_KEY) ?? null;
    }
    catch {
        raw = null;
    }
    let settings = parseSettings(raw);
    const listeners = new Set();
    return {
        get: () => ({ ...settings }),
        set(patch) {
            settings = {
                effectsVolume: patch.effectsVolume === undefined ? settings.effectsVolume : clampVolume(patch.effectsVolume),
                muted: patch.muted === undefined ? settings.muted : patch.muted === true
            };
            try {
                storage?.setItem(SETTINGS_STORAGE_KEY, serializeSettings(settings));
            }
            catch {
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
