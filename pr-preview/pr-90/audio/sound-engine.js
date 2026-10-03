// Priority sounds carry game-critical information, so they are never dropped by throttling.
const PRIORITY = new Set(["wave-start", "wave-clear", "win", "lose", "tower-destroyed"]);
const DEFAULT_THROTTLE = { minIntervalMs: 50, maxVoices: 2 };
const THROTTLES = {
    "tower-shot": { minIntervalMs: 60, maxVoices: 4 },
    "creature-kill": { minIntervalMs: 80, maxVoices: 3 },
    "tower-damaged": { minIntervalMs: 120, maxVoices: 3 },
    repair: { minIntervalMs: 200, maxVoices: 1 },
    "wave-clear-bonus": { minIntervalMs: 200, maxVoices: 1 }
};
const GLOBAL_VOICE_CAP = 16;
const HEADROOM = 0.6;
const PENTATONIC = [0, 2, 4, 7, 9, 12, 14, 16];
// Pitch by player number lets players tell whose tower fired without looking; deterministic on purpose.
function pitchRatio(playerNumber) {
    if (playerNumber === undefined) {
        return 1;
    }
    const semitone = PENTATONIC[(Math.max(1, Math.floor(playerNumber)) - 1) % PENTATONIC.length] ?? 0;
    return 2 ** (semitone / 12);
}
function tone(ctx, out, spec) {
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
function noise(ctx, out, buffer, spec) {
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
// Each recipe returns its length in seconds so the engine can track live voices.
const RECIPES = {
    "tower-shot": ({ ctx, out, t, k, g }) => {
        tone(ctx, out, { type: "square", freq: 880 * k, freqEnd: 330 * k, at: t, dur: 0.09, gain: 0.18 * g });
        return 0.11;
    },
    "creature-kill": ({ ctx, out, t, k, g }) => {
        tone(ctx, out, { type: "triangle", freq: 440 * k, freqEnd: 880 * k, at: t, dur: 0.12, gain: 0.25 * g });
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
function defaultCreateContext() {
    const scope = globalThis;
    const Ctor = scope.AudioContext ?? scope.webkitAudioContext;
    return Ctor ? new Ctor() : null;
}
function buildNoise(ctx) {
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
export function createSoundEngine(options) {
    const { settings } = options;
    const createContext = options.createContext ?? defaultCreateContext;
    const now = options.now ?? (() => performance.now());
    const isHidden = options.isHidden ?? (() => typeof document !== "undefined" && document.hidden);
    let ctx = null;
    let master = null;
    let noiseBuffer = null;
    let disabled = false;
    const voices = new Map();
    let allVoices = [];
    let unlockTarget = null;
    let gestureTarget = null;
    const visibilityTarget = options.visibilityTarget ?? (typeof document !== "undefined" ? document : null);
    visibilityTarget?.addEventListener("visibilitychange", () => {
        if (isHidden()) {
            cancelPending();
        }
    });
    const gesture = () => unlock();
    const GESTURES = ["pointerdown", "keydown", "touchend"];
    function detach() {
        if (!unlockTarget) {
            return;
        }
        for (const name of GESTURES) {
            unlockTarget.removeEventListener(name, gesture);
        }
        unlockTarget = null;
    }
    function arm() {
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
    function cancelPending() {
        const current = now();
        const isPending = (voice) => voice.bus !== undefined && voice.start > current;
        for (const voice of allVoices.filter(isPending)) {
            try {
                voice.bus?.disconnect();
            }
            catch {
                // Already disconnected.
            }
        }
        allVoices = allVoices.filter((voice) => !isPending(voice));
        for (const [id, list] of voices) {
            voices.set(id, list.filter((voice) => !isPending(voice)));
        }
    }
    function applyGain() {
        if (!ctx || !master) {
            return;
        }
        if (settings.effectiveGain() <= 0) {
            cancelPending();
        }
        const volume = settings.effectiveGain();
        master.gain.setTargetAtTime(volume * volume, ctx.currentTime, 0.02);
    }
    function ensureContext() {
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
            ctx = created;
            master = gain;
            noiseBuffer = buildNoise(created);
            gain.gain.value = settings.effectiveGain() ** 2;
            settings.subscribe(applyGain);
            // Safari can suspend or interrupt a running context later (tab switch, call); the next gesture must be able to resume it.
            created.addEventListener?.("statechange", () => {
                if (created.state === "running") {
                    detach();
                }
                else {
                    arm();
                    cancelPending();
                }
            });
            return ctx;
        }
        catch {
            disabled = true;
            ctx = null;
            return null;
        }
    }
    function unlock() {
        const context = ensureContext();
        if (!context) {
            detach();
            return;
        }
        if (context.state === "running") {
            detach();
            return;
        }
        try {
            void Promise.resolve(context.resume())
                .then(() => {
                if (context.state === "running") {
                    detach();
                }
            })
                .catch(() => undefined);
        }
        catch {
            disabled = true;
            detach();
        }
    }
    function play(cue, delayMs = 0) {
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
            const overlaps = (voice) => voice.start <= at && voice.end > at;
            if (own.filter(overlaps).length >= rule.maxVoices || allVoices.filter(overlaps).length >= GLOBAL_VOICE_CAP) {
                return;
            }
        }
        try {
            let bus;
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
            const voice = { start: at, end: at + seconds * 1000, bus };
            own.push(voice);
            voices.set(cue.id, own);
            allVoices.push(voice);
        }
        catch {
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
