import assert from "node:assert/strict";
import { test } from "node:test";
import { createSoundEngine } from "./audio/sound-engine.js";
import { createSettingsStore } from "./settings/settings.js";

interface FakeNode {
  kind: string;
  gain: { value: number; setTargetAtTime: (v: number) => void; setValueAtTime: () => void; exponentialRampToValueAtTime: () => void };
  frequency: { setValueAtTime: () => void; exponentialRampToValueAtTime: () => void };
  [key: string]: unknown;
}

function fakeContext(state: "running" | "suspended" = "running") {
  const created: FakeNode[] = [];
  const starts: number[] = [];
  const stateListeners: Array<() => void> = [];
  const disconnected: FakeNode[] = [];
  const masterTargets: number[] = [];
  const param = () => ({ value: 1, setValueAtTime() {}, exponentialRampToValueAtTime() {}, setTargetAtTime(v: number) { masterTargets.push(v); } });
  const node = (kind: string): FakeNode => {
    const n = {
      kind,
      gain: param(),
      frequency: param(),
      connect() {},
      disconnect() {
        disconnected.push(n);
      },
      start(at: number) {
        starts.push(at);
      },
      stop() {}
    } as unknown as FakeNode;
    created.push(n);
    return n;
  };
  const ctx = {
    state: state as string,
    resumeBecomesRunning: true,
    addEventListener: (_name: string, fn: () => void) => stateListeners.push(fn),
    setState(next: string) {
      ctx.state = next;
      stateListeners.forEach((fn) => fn());
    },
    currentTime: 0,
    sampleRate: 1000,
    destination: {},
    resumeCalls: 0,
    resume() {
      ctx.resumeCalls += 1;
      if (!ctx.resumeBecomesRunning) {
        return Promise.reject(new Error("needs gesture"));
      }
      return Promise.resolve().then(() => ctx.setState("running"));
    },
    createGain: () => node("gain"),
    createDynamicsCompressor: () => node("compressor"),
    createOscillator: () => node("osc"),
    createBiquadFilter: () => node("filter"),
    createBufferSource: () => node("source"),
    createBuffer: (_c: number, length: number) => ({ getChannelData: () => new Float32Array(length) })
  };
  return { ctx, created, masterTargets, starts, disconnected };
}

function setup(opts: { state?: "running" | "suspended"; hidden?: () => boolean; muted?: boolean; visibilityTarget?: EventTarget | undefined } = {}) {
  const fake = fakeContext(opts.state);
  const settings = createSettingsStore(null);
  if (opts.muted) {
    settings.set({ muted: true });
  }
  let time = 1000;
  const engine = createSoundEngine({
    settings,
    createContext: () => fake.ctx as unknown as AudioContext,
    now: () => time,
    isHidden: opts.hidden ?? (() => false),
    visibilityTarget: opts.visibilityTarget
  });
  return { fake, settings, engine, advance: (ms: number) => (time += ms) };
}

const voices = (created: FakeNode[]) => created.filter((n) => n.kind === "osc" || n.kind === "source").length;

test("no AudioContext available is a permanent no-op", () => {
  const engine = createSoundEngine({ settings: createSettingsStore(null), createContext: () => null, isHidden: () => false });
  assert.doesNotThrow(() => {
    engine.unlock();
    engine.play({ id: "win" });
    engine.playCues([{ id: "ui-click" }], 100);
    engine.previewVolume();
  });
});

test("a throwing context factory is swallowed", () => {
  const engine = createSoundEngine({
    settings: createSettingsStore(null),
    createContext: () => {
      throw new Error("blocked");
    }
  });
  assert.doesNotThrow(() => engine.unlock());
  assert.doesNotThrow(() => engine.play({ id: "win" }));
});

test("plays nothing before unlock creates the context", () => {
  const { fake, engine } = setup();
  engine.play({ id: "ui-click" });
  assert.equal(fake.created.length, 0);
});

test("a suspended context makes no voices and unlock resumes it", () => {
  const { fake, engine } = setup({ state: "suspended" });
  engine.unlock();
  const before = fake.created.length;
  engine.play({ id: "win" });
  assert.equal(fake.created.length, before);
  assert.equal(fake.ctx.resumeCalls, 1);
});

test("muted makes no voices", () => {
  const { fake, engine } = setup({ muted: true });
  engine.unlock();
  engine.play({ id: "win" });
  assert.equal(voices(fake.created), 0);
});

test("hidden document makes no voices", () => {
  const { fake, engine } = setup({ hidden: () => true });
  engine.unlock();
  engine.play({ id: "win" });
  assert.equal(voices(fake.created), 0);
});

test("running context plays and master gain follows the squared volume", () => {
  const { fake, engine, settings } = setup();
  engine.unlock();
  engine.play({ id: "ui-click" });
  assert.ok(voices(fake.created) > 0);
  settings.set({ effectsVolume: 0.5 });
  assert.equal(fake.masterTargets.at(-1), 0.25);
  settings.set({ muted: true });
  assert.equal(fake.masterTargets.at(-1), 0);
});

test("per-id interval throttles, and later play is allowed", () => {
  const { fake, engine, advance } = setup();
  engine.unlock();
  engine.play({ id: "wall-hit" });
  const first = voices(fake.created);
  engine.play({ id: "wall-hit" });
  assert.equal(voices(fake.created), first);
  advance(500);
  engine.play({ id: "wall-hit" });
  assert.equal(voices(fake.created), first * 2);
});

test("priority sounds are never throttled", () => {
  const { fake, engine } = setup();
  engine.unlock();
  engine.play({ id: "tower-destroyed" });
  const one = voices(fake.created);
  engine.play({ id: "tower-destroyed" });
  assert.equal(voices(fake.created), one * 2);
});

test("playCues spreads cues over the glide time", () => {
  const { fake, engine } = setup();
  engine.unlock();
  engine.playCues([{ id: "creature-kill" }, { id: "creature-kill" }, { id: "creature-kill" }], 600);
  assert.equal(voices(fake.created), 3);
  assert.deepEqual(fake.starts.map((t) => Math.round(t * 1000) / 1000), [0, 0.2, 0.4]);
});

test("an immediate cue after a single delayed cue is not throttled by it", () => {
  const { fake, engine } = setup();
  engine.unlock();
  engine.play({ id: "wall-hit" }, 500);
  engine.play({ id: "wall-hit" });
  assert.equal(voices(fake.created), 2);
});

test("maxVoices per id limits overlapping voices", () => {
  const { fake, engine, advance } = setup();
  engine.unlock();
  // repair allows one voice at a time and lasts ~320ms.
  engine.play({ id: "repair" });
  const one = voices(fake.created);
  advance(250);
  engine.play({ id: "repair" });
  assert.equal(voices(fake.created), one);
  advance(300);
  engine.play({ id: "repair" });
  assert.equal(voices(fake.created), one * 2);
});

test("a scheduled but not yet started voice does not block an earlier cue", () => {
  const { fake, engine } = setup();
  engine.unlock();
  engine.play({ id: "repair" }, 5000);
  const one = voices(fake.created);
  engine.play({ id: "repair" });
  assert.equal(voices(fake.created), one * 2);
});

test("the global voice cap drops non-priority sounds but not priority ones", () => {
  const { fake, engine } = setup();
  engine.unlock();
  const ids = ["tower-shot", "creature-kill", "tower-damaged", "wall-hit", "wall-destroyed", "repair", "place-tower", "place-wall", "upgrade", "ready", "rejected", "wave-clear-bonus", "wave-start", "tower-destroyed"] as const;
  // Spacing beyond every per-id interval but inside the longer sounds, so voices overlap.
  for (let step = 0; step < 6; step += 1) {
    for (const id of ids) {
      engine.play({ id }, step * 60);
    }
  }
  const live = voices(fake.created);
  engine.play({ id: "ui-click" }, 130);
  assert.equal(voices(fake.created), live);
  engine.play({ id: "win" }, 130);
  assert.ok(voices(fake.created) > live);
});

test("volume 0 makes no voices", () => {
  const { fake, engine, settings } = setup();
  engine.unlock();
  settings.set({ effectsVolume: 0 });
  engine.play({ id: "win" });
  assert.equal(voices(fake.created), 0);
});

test("play after a failed resume makes no voices", async () => {
  const { fake, engine } = setup({ state: "suspended" });
  fake.ctx.resumeBecomesRunning = false;
  engine.unlock();
  await new Promise((resolve) => setImmediate(resolve));
  engine.play({ id: "win" });
  assert.equal(voices(fake.created), 0);
});

class TrackingTarget extends EventTarget {
  readonly active = new Set<string>();
  override addEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions): void {
    this.active.add(type);
    super.addEventListener(type, listener, options);
  }
  override removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | EventListenerOptions): void {
    this.active.delete(type);
    super.removeEventListener(type, listener, options);
  }
}

test("gesture listeners are removed once running", async () => {
  const { engine } = setup({ state: "suspended" });
  const target = new TrackingTarget();
  engine.bindUnlock(target);
  assert.deepEqual([...target.active].sort(), ["keydown", "pointerdown", "touchend"]);
  target.dispatchEvent(new Event("pointerdown"));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(target.active.size, 0);
});

test("gesture listeners stay bound while the context stays suspended", async () => {
  const { fake, engine } = setup({ state: "suspended" });
  fake.ctx.resumeBecomesRunning = false;
  const target = new TrackingTarget();
  engine.bindUnlock(target);
  target.dispatchEvent(new Event("pointerdown"));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(target.active.size, 3);
});

test("listeners are re-armed when a running context is later suspended", async () => {
  const { fake, engine } = setup({ state: "suspended" });
  const target = new TrackingTarget();
  engine.bindUnlock(target);
  target.dispatchEvent(new Event("pointerdown"));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(target.active.size, 0);
  fake.ctx.setState("suspended");
  assert.equal(target.active.size, 3);
  fake.ctx.setState("running");
  target.dispatchEvent(new Event("keydown"));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(target.active.size, 0);
});

test("a running transition removes the re-armed gesture listeners", async () => {
  const { fake, engine } = setup({ state: "suspended" });
  const target = new TrackingTarget();
  engine.bindUnlock(target);
  target.dispatchEvent(new Event("pointerdown"));
  await new Promise((resolve) => setImmediate(resolve));
  fake.ctx.setState("suspended");
  assert.equal(target.active.size, 3);
  fake.ctx.setState("running");
  assert.equal(target.active.size, 0);
});

test("delayed cues are cancelled when the context is suspended before they start", () => {
  const { fake, engine } = setup();
  engine.unlock();
  engine.playCues([{ id: "creature-kill" }, { id: "creature-kill" }], 600);
  assert.equal(fake.disconnected.length, 0);
  fake.ctx.setState("suspended");
  assert.ok(fake.disconnected.length > 0);
});

test("delayed cues are cancelled when the tab becomes hidden", () => {
  const target = new EventTarget();
  let hidden = false;
  const { fake, engine } = setup({ hidden: () => hidden, visibilityTarget: target });
  engine.unlock();
  engine.playCues([{ id: "creature-kill" }, { id: "creature-kill" }], 600);
  hidden = true;
  target.dispatchEvent(new Event("visibilitychange"));
  assert.ok(fake.disconnected.length > 0);
});

test("delayed cues are cancelled when muted before they start", () => {
  const { fake, settings, engine } = setup();
  engine.unlock();
  engine.playCues([{ id: "creature-kill" }, { id: "creature-kill" }], 600);
  settings.set({ muted: true });
  assert.ok(fake.disconnected.length > 0);
});
