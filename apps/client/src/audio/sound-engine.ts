import type { SettingsStore } from "../settings/settings.js";
import type { SoundCue, SoundId } from "./sound-cues.js";

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
  /** Repeating timer for the music scheduler; defaults to setInterval. Injectable so tests stay deterministic. */
  startTimer?: (callback: () => void, ms: number) => unknown;
  stopTimer?: (handle: unknown) => void;
}

interface Throttle {
  minIntervalMs: number;
  maxVoices: number;
}

// Priority sounds carry game-critical information, so they are never dropped by throttling.
const PRIORITY: ReadonlySet<SoundId> = new Set(["wave-start", "wave-clear", "win", "lose", "tower-destroyed", "boss-spawn", "boss-defeated"]);
const DEFAULT_THROTTLE: Throttle = { minIntervalMs: 50, maxVoices: 2 };
const THROTTLES: Partial<Record<SoundId, Throttle>> = {
  "tower-shot": { minIntervalMs: 60, maxVoices: 3 },
  "cannon-shot": { minIntervalMs: 120, maxVoices: 2 },
  "frost-shot": { minIntervalMs: 90, maxVoices: 2 },
  "cannon-splash": { minIntervalMs: 150, maxVoices: 1 },
  "creature-split": { minIntervalMs: 120, maxVoices: 2 },
  "boss-hit": { minIntervalMs: 200, maxVoices: 1 },
  "creature-kill": { minIntervalMs: 80, maxVoices: 3 },
  "tower-damaged": { minIntervalMs: 120, maxVoices: 3 },
  repair: { minIntervalMs: 200, maxVoices: 1 },
  "wave-clear-bonus": { minIntervalMs: 200, maxVoices: 1 }
};
// Lower than before: dense 8-player waves sounded harsh when every shot and kill stacked up.
const GLOBAL_VOICE_CAP = 12;
const HEADROOM = 0.6;
// Music: a quiet looping arpeggio over a four-chord bass line, generated with oscillators (no audio files).
const MUSIC_STEP_SECONDS = 0.5;
const MUSIC_LOOKAHEAD_SECONDS = 1.2;
const MUSIC_TICK_MS = 400;
const MUSIC_BASS_ROOTS = [110, 87.31, 130.81, 98];
const MUSIC_ARPEGGIO = [1, 1.5, 2, 1.5];
const MUSIC_STEPS_PER_BAR = 8;
// The music bus sits well below effects so a busy wave is never masked by it.
const MUSIC_LEVEL = 0.35;
const MUSIC_DUCK_LEVEL = 0.3;

const PENTATONIC = [0, 2, 4, 7, 9, 12, 14, 16];

// Pitch by player number lets players tell whose tower fired without looking; deterministic on purpose.
function pitchRatio(playerNumber: number | undefined): number {
  if (playerNumber === undefined) {
    return 1;
  }
  const semitone = PENTATONIC[(Math.max(1, Math.floor(playerNumber)) - 1) % PENTATONIC.length] ?? 0;
  return 2 ** (semitone / 12);
}

interface ToneSpec {
  type: OscillatorType;
  freq: number;
  freqEnd?: number;
  at: number;
  dur: number;
  gain: number;
}

function tone(ctx: AudioContext, out: AudioNode, spec: ToneSpec): void {
  const osc = ctx.createOscillator();
  const env = ctx.createGain();
  osc.type = spec.type;
  osc.frequency.setValueAtTime(spec.freq, spec.at);
  if (spec.freqEnd !== undefined) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, spec.freqEnd), spec.at + spec.dur);
  }
  env.gain.setValueAtTime(0.0001, spec.at);
  env.gain.exponentialRampToValueAtTime(Math.max(0.0001, spec.gain), spec.at + 0.01);
  env.gain.exponentialRampToValueAtTime(0.0001, spec.at + spec.dur);
  osc.connect(env);
  env.connect(out);
  osc.onended = () => {
    osc.disconnect();
    env.disconnect();
  };
  osc.start(spec.at);
  osc.stop(spec.at + spec.dur + 0.02);
}

interface NoiseSpec {
  at: number;
  dur: number;
  gain: number;
  filter: BiquadFilterType;
  freq: number;
}

function noise(ctx: AudioContext, out: AudioNode, buffer: AudioBuffer, spec: NoiseSpec): void {
  const src = ctx.createBufferSource();
  const filter = ctx.createBiquadFilter();
  const env = ctx.createGain();
  src.buffer = buffer;
  filter.type = spec.filter;
  filter.frequency.setValueAtTime(spec.freq, spec.at);
  env.gain.setValueAtTime(spec.gain, spec.at);
  env.gain.exponentialRampToValueAtTime(0.0001, spec.at + spec.dur);
  src.connect(filter);
  filter.connect(env);
  env.connect(out);
  src.onended = () => {
    src.disconnect();
    filter.disconnect();
    env.disconnect();
  };
  src.start(spec.at);
  src.stop(spec.at + spec.dur + 0.02);
}

interface RecipeKit {
  ctx: AudioContext;
  out: AudioNode;
  noiseBuffer: AudioBuffer;
  t: number;
  k: number;
  g: number;
}

// Each recipe returns its length in seconds so the engine can track live voices.
const RECIPES: Record<SoundId, (kit: RecipeKit) => number> = {
  "tower-shot": ({ ctx, out, t, k, g }) => {
    tone(ctx, out, { type: "square", freq: 880 * k, freqEnd: 330 * k, at: t, dur: 0.09, gain: 0.13 * g });
    return 0.11;
  },
  // Cannon: a low thump so it sits under the arrow clicks.
  "cannon-shot": ({ ctx, out, noiseBuffer, t, g }) => {
    tone(ctx, out, { type: "sine", freq: 150, freqEnd: 50, at: t, dur: 0.18, gain: 0.3 * g });
    noise(ctx, out, noiseBuffer, { at: t, dur: 0.08, gain: 0.12 * g, filter: "lowpass", freq: 300 });
    return 0.2;
  },
  // Frost: a soft two-note chime.
  "frost-shot": ({ ctx, out, t, k, g }) => {
    tone(ctx, out, { type: "sine", freq: 1320 * k, at: t, dur: 0.16, gain: 0.1 * g });
    tone(ctx, out, { type: "sine", freq: 1760 * k, at: t + 0.04, dur: 0.18, gain: 0.07 * g });
    return 0.24;
  },
  "cannon-splash": ({ ctx, out, noiseBuffer, t, g }) => {
    noise(ctx, out, noiseBuffer, { at: t, dur: 0.22, gain: 0.18 * g, filter: "lowpass", freq: 700 });
    tone(ctx, out, { type: "sine", freq: 90, freqEnd: 45, at: t, dur: 0.2, gain: 0.2 * g });
    return 0.24;
  },
  "creature-split": ({ ctx, out, t, g }) => {
    tone(ctx, out, { type: "triangle", freq: 520, freqEnd: 780, at: t, dur: 0.07, gain: 0.14 * g });
    tone(ctx, out, { type: "triangle", freq: 390, freqEnd: 600, at: t + 0.05, dur: 0.08, gain: 0.14 * g });
    return 0.15;
  },
  "boss-hit": ({ ctx, out, noiseBuffer, t, g }) => {
    tone(ctx, out, { type: "square", freq: 110, freqEnd: 80, at: t, dur: 0.08, gain: 0.12 * g });
    noise(ctx, out, noiseBuffer, { at: t, dur: 0.05, gain: 0.1 * g, filter: "highpass", freq: 2000 });
    return 0.1;
  },
  "boss-spawn": ({ ctx, out, t, g }) => {
    tone(ctx, out, { type: "sawtooth", freq: 75, freqEnd: 55, at: t, dur: 0.9, gain: 0.22 * g });
    tone(ctx, out, { type: "sawtooth", freq: 112, freqEnd: 82, at: t + 0.15, dur: 0.7, gain: 0.14 * g });
    return 0.95;
  },
  "boss-defeated": ({ ctx, out, noiseBuffer, t, k, g }) => {
    noise(ctx, out, noiseBuffer, { at: t, dur: 0.5, gain: 0.3 * g, filter: "lowpass", freq: 600 });
    tone(ctx, out, { type: "sawtooth", freq: 120, freqEnd: 40, at: t, dur: 0.6, gain: 0.22 * g });
    [392 * k, 523.25 * k, 659.25 * k].forEach((freq, i) => tone(ctx, out, { type: "triangle", freq, at: t + 0.45 + i * 0.1, dur: 0.3, gain: 0.18 * g }));
    return 1.0;
  },
  "creature-kill": ({ ctx, out, t, k, g }) => {
    tone(ctx, out, { type: "triangle", freq: 440 * k, freqEnd: 880 * k, at: t, dur: 0.12, gain: 0.2 * g });
    return 0.14;
  },
  "tower-damaged": ({ ctx, out, noiseBuffer, t, k, g }) => {
    noise(ctx, out, noiseBuffer, { at: t, dur: 0.15, gain: 0.3 * g, filter: "lowpass", freq: 900 });
    tone(ctx, out, { type: "sawtooth", freq: 160 * k, freqEnd: 90 * k, at: t, dur: 0.15, gain: 0.15 * g });
    return 0.17;
  },
  "tower-destroyed": ({ ctx, out, noiseBuffer, t, k, g }) => {
    noise(ctx, out, noiseBuffer, { at: t, dur: 0.6, gain: 0.5 * g, filter: "lowpass", freq: 500 });
    tone(ctx, out, { type: "sawtooth", freq: 140 * k, freqEnd: 40, at: t, dur: 0.6, gain: 0.3 * g });
    return 0.62;
  },
  "wave-start": ({ ctx, out, t, g }) => {
    tone(ctx, out, { type: "sawtooth", freq: 196, at: t, dur: 0.25, gain: 0.2 * g });
    tone(ctx, out, { type: "sawtooth", freq: 294, at: t + 0.18, dur: 0.35, gain: 0.2 * g });
    return 0.55;
  },
  "wave-clear": ({ ctx, out, t, g }) => {
    [523.25, 659.25, 783.99].forEach((freq, i) => tone(ctx, out, { type: "triangle", freq, at: t + i * 0.1, dur: 0.25, gain: 0.25 * g }));
    return 0.55;
  },
  "wave-clear-bonus": ({ ctx, out, t, g }) => {
    tone(ctx, out, { type: "sine", freq: 1568, at: t + 0.3, dur: 0.2, gain: 0.15 * g });
    tone(ctx, out, { type: "sine", freq: 2093, at: t + 0.38, dur: 0.25, gain: 0.12 * g });
    return 0.7;
  },
  repair: ({ ctx, out, t, g }) => {
    tone(ctx, out, { type: "sine", freq: 330, freqEnd: 660, at: t, dur: 0.3, gain: 0.2 * g });
    return 0.32;
  },
  win: ({ ctx, out, t, g }) => {
    [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => tone(ctx, out, { type: "triangle", freq, at: t + i * 0.14, dur: 0.4, gain: 0.28 * g }));
    return 0.98;
  },
  lose: ({ ctx, out, t, g }) => {
    [392, 330, 262, 196].forEach((freq, i) => tone(ctx, out, { type: "sawtooth", freq, at: t + i * 0.2, dur: 0.4, gain: 0.2 * g }));
    return 1.2;
  },
  "place-tower": ({ ctx, out, t, g }) => {
    tone(ctx, out, { type: "square", freq: 220, freqEnd: 440, at: t, dur: 0.12, gain: 0.18 * g });
    return 0.14;
  },
  upgrade: ({ ctx, out, t, g }) => {
    tone(ctx, out, { type: "triangle", freq: 440, at: t, dur: 0.1, gain: 0.22 * g });
    tone(ctx, out, { type: "triangle", freq: 660, at: t + 0.08, dur: 0.14, gain: 0.22 * g });
    return 0.24;
  },
  ready: ({ ctx, out, t, g }) => {
    tone(ctx, out, { type: "sine", freq: 523.25, at: t, dur: 0.08, gain: 0.2 * g });
    tone(ctx, out, { type: "sine", freq: 784, at: t + 0.07, dur: 0.12, gain: 0.2 * g });
    return 0.2;
  },
  rejected: ({ ctx, out, t, g }) => {
    tone(ctx, out, { type: "square", freq: 180, freqEnd: 120, at: t, dur: 0.14, gain: 0.15 * g });
    return 0.16;
  },
  "ui-click": ({ ctx, out, t, g }) => {
    tone(ctx, out, { type: "sine", freq: 700, at: t, dur: 0.04, gain: 0.15 * g });
    return 0.06;
  }
};

function defaultCreateContext(): AudioContext | null {
  const scope = globalThis as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
  const Ctor = scope.AudioContext ?? scope.webkitAudioContext;
  return Ctor ? new Ctor() : null;
}

function buildNoise(ctx: AudioContext): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * 0.7);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  // Deterministic LCG instead of Math.random so renders are reproducible.
  let seed = 12345;
  for (let i = 0; i < length; i += 1) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    data[i] = seed / 0x80000000 - 1;
  }
  return buffer;
}

export function createSoundEngine(options: SoundEngineOptions): SoundEngine {
  const { settings } = options;
  const createContext = options.createContext ?? defaultCreateContext;
  const now = options.now ?? (() => performance.now());
  const isHidden = options.isHidden ?? (() => typeof document !== "undefined" && document.hidden);

  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let noiseBuffer: AudioBuffer | null = null;
  let disabled = false;
  // Voices keep their scheduled window so a cue delayed into the future does not count against, or throttle, earlier ones.
  interface Voice {
    start: number;
    end: number;
    // Only delayed voices get their own bus, so they can be silenced before they start.
    bus?: AudioNode | undefined;
  }
  const voices = new Map<SoundId, Voice[]>();
  let allVoices: Voice[] = [];
  let musicBus: GainNode | null = null;
  let musicDuck: GainNode | null = null;
  let mixInput: AudioNode | null = null;
  let musicTimer: unknown = null;
  let musicStep = 0;
  let musicNextTime = 0;
  const startTimer = options.startTimer ?? ((callback: () => void, ms: number) => setInterval(callback, ms));
  const stopTimer = options.stopTimer ?? ((handle: unknown) => clearInterval(handle as ReturnType<typeof setInterval>));
  let unlockTarget: EventTarget | null = null;
  let gestureTarget: EventTarget | null = null;

  const visibilityTarget = options.visibilityTarget ?? (typeof document !== "undefined" ? document : null);
  visibilityTarget?.addEventListener("visibilitychange", () => {
    if (isHidden()) {
      cancelPending();
    }
    syncMusic();
  });

  const gesture = () => unlock();
  const GESTURES = ["pointerdown", "keydown", "touchend"];

  function detach(): void {
    if (!unlockTarget) {
      return;
    }
    for (const name of GESTURES) {
      unlockTarget.removeEventListener(name, gesture);
    }
    unlockTarget = null;
  }

  function arm(): void {
    if (!gestureTarget || unlockTarget || disabled) {
      return;
    }
    unlockTarget = gestureTarget;
    for (const name of GESTURES) {
      unlockTarget.addEventListener(name, gesture);
    }
  }

  // Delayed cues are already queued as Web Audio nodes; the guards in play() ran at queue time, so
  // re-check them on state changes by cutting the not-yet-started ones off from the output.
  function cancelPending(): void {
    const current = now();
    const isPending = (voice: Voice) => voice.bus !== undefined && voice.start > current;
    for (const voice of allVoices.filter(isPending)) {
      try {
        voice.bus?.disconnect();
      } catch {
        // Already disconnected.
      }
    }
    allVoices = allVoices.filter((voice) => !isPending(voice));
    for (const [id, list] of voices) {
      voices.set(id, list.filter((voice) => !isPending(voice)));
    }
  }

  function applyGain(): void {
    if (!ctx || !master) {
      return;
    }
    if (settings.effectiveGain() <= 0) {
      cancelPending();
    }
    const volume = settings.effectiveGain();
    master.gain.setTargetAtTime(volume * volume, ctx.currentTime, 0.02);
    syncMusic();
  }

  function scheduleMusic(): void {
    if (!ctx || !musicDuck || !noiseBuffer) {
      return;
    }
    while (musicNextTime < ctx.currentTime + MUSIC_LOOKAHEAD_SECONDS) {
      const bar = Math.floor(musicStep / MUSIC_STEPS_PER_BAR) % MUSIC_BASS_ROOTS.length;
      const inBar = musicStep % MUSIC_STEPS_PER_BAR;
      const root = MUSIC_BASS_ROOTS[bar] ?? 110;
      const at = Math.max(musicNextTime, ctx.currentTime);
      if (inBar === 0) {
        tone(ctx, musicDuck, { type: "sine", freq: root, at, dur: MUSIC_STEP_SECONDS * 6, gain: 0.5 });
      }
      if (inBar % 2 === 0) {
        const ratio = MUSIC_ARPEGGIO[(inBar / 2) % MUSIC_ARPEGGIO.length] ?? 1;
        tone(ctx, musicDuck, { type: "triangle", freq: root * 4 * ratio, at, dur: MUSIC_STEP_SECONDS * 1.6, gain: 0.16 });
      }
      musicStep += 1;
      musicNextTime += MUSIC_STEP_SECONDS;
    }
  }

  function stopMusic(): void {
    if (musicTimer !== null) {
      stopTimer(musicTimer);
      musicTimer = null;
    }
    if (ctx && musicBus) {
      // Already scheduled notes are silenced rather than cut, so there is no click.
      musicBus.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
    }
  }

  // The loop runs only while it is enabled, audible, unlocked and the tab is visible. Otherwise no music nodes are made.
  function syncMusic(): void {
    const gain = settings.effectiveMusicGain();
    const allowed = gain > 0 && !disabled && ctx !== null && ctx.state === "running" && !isHidden() && mixInput !== null;
    if (!allowed || !ctx || !mixInput) {
      stopMusic();
      return;
    }
    if (!musicBus || !musicDuck) {
      musicBus = ctx.createGain();
      musicDuck = ctx.createGain();
      musicBus.connect(musicDuck);
      musicDuck.connect(mixInput);
    }
    musicBus.gain.setTargetAtTime(gain * gain * MUSIC_LEVEL, ctx.currentTime, 0.05);
    if (musicTimer === null) {
      musicNextTime = ctx.currentTime;
      scheduleMusic();
      musicTimer = startTimer(() => {
        try {
          scheduleMusic();
        } catch {
          stopMusic();
        }
      }, MUSIC_TICK_MS);
    }
  }

  // Priority sounds briefly pull the music down so they stay clear.
  function duckMusic(): void {
    if (!ctx || !musicDuck || musicTimer === null) {
      return;
    }
    musicDuck.gain.setTargetAtTime(MUSIC_DUCK_LEVEL, ctx.currentTime, 0.03);
    musicDuck.gain.setTargetAtTime(1, ctx.currentTime + 0.9, 0.3);
  }

  function ensureContext(): AudioContext | null {
    if (disabled) {
      return null;
    }
    if (ctx) {
      return ctx;
    }
    try {
      const created = createContext();
      if (!created) {
        disabled = true;
        return null;
      }
      const gain = created.createGain();
      const compressor = created.createDynamicsCompressor();
      const headroom = created.createGain();
      headroom.gain.value = HEADROOM;
      gain.connect(compressor);
      compressor.connect(headroom);
      headroom.connect(created.destination);
      mixInput = compressor;
      ctx = created;
      master = gain;
      noiseBuffer = buildNoise(created);
      gain.gain.value = settings.effectiveGain() ** 2;
      settings.subscribe(applyGain);
      // Safari can suspend or interrupt a running context later (tab switch, call); the next gesture must be able to resume it.
      created.addEventListener?.("statechange", () => {
        if (created.state === "running") {
          detach();
        } else {
          arm();
          cancelPending();
        }
        syncMusic();
      });
      return ctx;
    } catch {
      disabled = true;
      ctx = null;
      return null;
    }
  }

  function unlock(): void {
    const context = ensureContext();
    if (!context) {
      detach();
      return;
    }
    if (context.state === "running") {
      detach();
      syncMusic();
      return;
    }
    try {
      void Promise.resolve(context.resume())
        .then(() => {
          if (context.state === "running") {
            detach();
            syncMusic();
          }
        })
        .catch(() => undefined);
    } catch {
      disabled = true;
      detach();
    }
  }

  function play(cue: SoundCue, delayMs = 0): void {
    if (disabled || !ctx || !master || !noiseBuffer) {
      return;
    }
    if (settings.effectiveGain() <= 0 || ctx.state !== "running" || isHidden()) {
      return;
    }
    const at = now() + delayMs;
    const priority = PRIORITY.has(cue.id);
    // Voices that already ended are forgotten; future ones stay but only count when their window covers `at`.
    const own = (voices.get(cue.id) ?? []).filter((voice) => voice.end > now());
    allVoices = allVoices.filter((voice) => voice.end > now());
    if (!priority) {
      const rule = THROTTLES[cue.id] ?? DEFAULT_THROTTLE;
      if (own.some((voice) => Math.abs(at - voice.start) < rule.minIntervalMs)) {
        return;
      }
      const overlaps = (voice: Voice) => voice.start <= at && voice.end > at;
      if (own.filter(overlaps).length >= rule.maxVoices || allVoices.filter(overlaps).length >= GLOBAL_VOICE_CAP) {
        return;
      }
    }
    try {
      let bus: GainNode | undefined;
      if (delayMs > 0) {
        bus = ctx.createGain();
        bus.connect(master);
      }
      const seconds = RECIPES[cue.id]({
        ctx,
        out: bus ?? master,
        noiseBuffer,
        t: ctx.currentTime + delayMs / 1000,
        k: pitchRatio(cue.playerNumber),
        g: cue.intensity ?? 1
      });
      const voice: Voice = { start: at, end: at + seconds * 1000, bus };
      own.push(voice);
      voices.set(cue.id, own);
      allVoices.push(voice);
      if (priority) {
        duckMusic();
      }
    } catch {
      disabled = true;
    }
  }

  return {
    unlock,
    bindUnlock(target) {
      gestureTarget = target;
      arm();
    },
    play,
    playCues(cues, glideMs) {
      const spread = Math.max(0, glideMs);
      cues.forEach((cue, index) => play(cue, cues.length > 1 ? (spread * index) / cues.length : 0));
    },
    previewVolume() {
      // A slider drag is a gesture, so this is also a safe moment to create the context.
      unlock();
      play({ id: "ui-click" });
    }
  };
}
