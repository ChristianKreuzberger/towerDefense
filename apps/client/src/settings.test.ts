import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_AUDIO_SETTINGS,
  SETTINGS_STORAGE_KEY,
  clampVolume,
  createSettingsStore,
  parseSettings,
  serializeSettings,
  type StorageLike
} from "./settings/settings.js";

function memoryStorage(initial?: Record<string, string>): StorageLike & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial ?? {}));
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    }
  };
}

const throwingStorage: StorageLike = {
  getItem: () => {
    throw new Error("denied");
  },
  setItem: () => {
    throw new Error("denied");
  }
};

test("clampVolume clamps, rejects NaN and non-numbers", () => {
  assert.equal(clampVolume(0.5), 0.5);
  assert.equal(clampVolume(-3), 0);
  assert.equal(clampVolume(7), 1);
  assert.equal(clampVolume(Number.NaN), DEFAULT_AUDIO_SETTINGS.effectsVolume);
  assert.equal(clampVolume("0.2"), DEFAULT_AUDIO_SETTINGS.effectsVolume);
  assert.equal(clampVolume(undefined), DEFAULT_AUDIO_SETTINGS.effectsVolume);
  assert.equal(clampVolume(Infinity), DEFAULT_AUDIO_SETTINGS.effectsVolume);
});

test("parseSettings falls back field-wise and on corrupt input", () => {
  assert.deepEqual(parseSettings(null), DEFAULT_AUDIO_SETTINGS);
  assert.deepEqual(parseSettings("{not json"), DEFAULT_AUDIO_SETTINGS);
  assert.deepEqual(parseSettings("[1]"), DEFAULT_AUDIO_SETTINGS);
  assert.deepEqual(parseSettings(JSON.stringify({ version: 1, effectsVolume: 0.3, muted: "yes" })), {
    effectsVolume: 0.3,
    muted: false
  });
  assert.deepEqual(parseSettings(JSON.stringify({ version: 1, effectsVolume: "loud", muted: true })), {
    effectsVolume: DEFAULT_AUDIO_SETTINGS.effectsVolume,
    muted: true
  });
});

test("parseSettings falls back to the default for out-of-range stored volumes", () => {
  for (const effectsVolume of [-1, 7]) {
    assert.deepEqual(parseSettings(JSON.stringify({ version: 1, effectsVolume, muted: true })), {
      effectsVolume: DEFAULT_AUDIO_SETTINGS.effectsVolume,
      muted: true
    });
  }
});

test("serializeSettings round-trips through parseSettings", () => {
  const settings = { effectsVolume: 0.25, muted: true };
  assert.deepEqual(JSON.parse(serializeSettings(settings)), { version: 1, effectsVolume: 0.25, muted: true });
  assert.deepEqual(parseSettings(serializeSettings(settings)), settings);
});

test("store loads defaults and persists changes", () => {
  const storage = memoryStorage();
  const store = createSettingsStore(storage);
  assert.deepEqual(store.get(), DEFAULT_AUDIO_SETTINGS);
  store.set({ effectsVolume: 0.4 });
  assert.deepEqual(parseSettings(storage.data.get(SETTINGS_STORAGE_KEY) ?? null), { effectsVolume: 0.4, muted: false });
  assert.deepEqual(createSettingsStore(storage).get(), { effectsVolume: 0.4, muted: false });
});

test("mute keeps the volume and zeroes the effective gain", () => {
  const store = createSettingsStore(memoryStorage());
  store.set({ effectsVolume: 0.6 });
  store.set({ muted: true });
  assert.equal(store.get().effectsVolume, 0.6);
  assert.equal(store.effectiveGain(), 0);
  store.set({ muted: false });
  assert.equal(store.effectiveGain(), 0.6);
});

test("store tolerates throwing and null storage", () => {
  for (const storage of [throwingStorage, null]) {
    const store = createSettingsStore(storage);
    assert.deepEqual(store.get(), DEFAULT_AUDIO_SETTINGS);
    store.set({ effectsVolume: 0.1 });
    assert.equal(store.get().effectsVolume, 0.1);
  }
});

test("subscribe notifies on change and stops after unsubscribe", () => {
  const store = createSettingsStore(memoryStorage());
  const seen: number[] = [];
  const off = store.subscribe((settings) => seen.push(settings.effectsVolume));
  store.set({ effectsVolume: 0.2 });
  off();
  store.set({ effectsVolume: 0.9 });
  assert.deepEqual(seen, [0.2]);
});
