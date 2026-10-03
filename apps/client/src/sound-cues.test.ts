import assert from "node:assert/strict";
import { test } from "node:test";
import type { MatchEvent, MatchPhase, MatchSnapshot } from "@tower-defense/shared";
import { cueForCommandResult, cuesForSnapshotChange } from "./audio/sound-cues.js";

function snap(phase: MatchPhase, extra: Partial<MatchSnapshot> = {}): MatchSnapshot {
  return {
    phase,
    wave: 1,
    towers: [{ id: "tower-p2", playerId: "p2", x: 0, y: 0, health: 10, maxHealth: 10, level: 1, targetMode: "first" }],
    ...extra
  } as MatchSnapshot;
}

function ev(partial: Record<string, unknown>): MatchEvent {
  return { wave: 1, tick: 1, ...partial } as unknown as MatchEvent;
}

function ids(events: MatchEvent[], opts: { previous?: MatchSnapshot | null; next?: MatchSnapshot; suppress?: boolean } = {}): string[] {
  const previous = opts.previous === undefined ? snap("wave") : opts.previous;
  return cuesForSnapshotChange({ previous, next: opts.next ?? snap("wave"), events, suppress: opts.suppress ?? false }).map((cue) => cue.id);
}

test("returns nothing without a previous snapshot or when suppressed", () => {
  const events = [ev({ type: "tower-destroyed", playerId: "p1" })];
  assert.deepEqual(ids(events, { previous: null }), []);
  assert.deepEqual(ids(events, { suppress: true }), []);
});

test("maps each event to its sound", () => {
  assert.deepEqual(ids([ev({ type: "tower-hit", towerId: "t1", playerId: "p1" })]), ["tower-shot"]);
  assert.deepEqual(ids([ev({ type: "creature-defeated", playerId: "p1" })]), ["creature-kill"]);
  assert.deepEqual(ids([ev({ type: "creature-attack", targetTowerId: "tower-p2" })]), ["tower-damaged"]);
  assert.deepEqual(ids([ev({ type: "tower-destroyed", playerId: "p1" })]), ["tower-destroyed"]);
  assert.deepEqual(ids([ev({ type: "wave-end" })]), ["wave-clear", "wave-clear-bonus"]);
  assert.deepEqual(ids([ev({ type: "tower-repaired" })]), ["repair"]);
});

test("pitch source is the owning player number", () => {
  const [shot] = cuesForSnapshotChange({
    previous: snap("wave"),
    next: snap("wave"),
    events: [ev({ type: "tower-hit", towerId: "t1", playerId: "p3" })],
    suppress: false
  });
  assert.equal(shot?.playerNumber, 3);
  const [hurt] = cuesForSnapshotChange({
    previous: snap("wave"),
    next: snap("wave"),
    events: [ev({ type: "creature-attack", targetTowerId: "tower-p2" })],
    suppress: false
  });
  assert.equal(hurt?.playerNumber, 2);
});

test("unmapped events make no sound", () => {
  assert.deepEqual(ids([ev({ type: "creature-spawned" }), ev({ type: "movement-resolved" }), ev({ type: "targets-selected" })]), []);
});

test("caps shots per tower and per snapshot, kills and repairs", () => {
  const shots = Array.from({ length: 10 }, (_, i) => ev({ type: "tower-hit", towerId: `t${i % 6}`, playerId: "p1" }));
  assert.equal(ids(shots).length, 4);
  const sameTower = [ev({ type: "tower-hit", towerId: "t1", playerId: "p1" }), ev({ type: "tower-hit", towerId: "t1", playerId: "p1" })];
  assert.equal(ids(sameTower).length, 1);
  assert.equal(ids(Array.from({ length: 8 }, () => ev({ type: "creature-defeated", playerId: "p1" }))).length, 3);
  assert.equal(ids(Array.from({ length: 5 }, () => ev({ type: "tower-repaired" }))).length, 1);
});

test("priority cues survive the caps", () => {
  const events = [
    ...Array.from({ length: 8 }, () => ev({ type: "creature-defeated", playerId: "p1" })),
    ev({ type: "tower-destroyed", playerId: "p1" }),
    ev({ type: "wave-end" })
  ];
  const result = ids(events);
  assert.ok(result.includes("tower-destroyed"));
  assert.ok(result.includes("wave-clear"));
});

test("wave start fires once from event or phase change", () => {
  assert.deepEqual(ids([ev({ type: "wave-start" })], { previous: snap("placement") }), ["wave-start"]);
  assert.deepEqual(ids([], { previous: snap("placement") }), ["wave-start"]);
  assert.deepEqual(ids([ev({ type: "wave-start" }), ev({ type: "wave-start" })], { previous: snap("placement") }), ["wave-start"]);
  assert.deepEqual(ids([], { previous: snap("wave") }), []);
});

test("win and lose fire on the transition into ended only", () => {
  assert.deepEqual(ids([], { next: snap("ended", { endReason: "score-win" }) }), ["win"]);
  assert.deepEqual(ids([], { next: snap("ended", { endReason: "all-towers-destroyed" }) }), ["lose"]);
  assert.deepEqual(ids([], { previous: snap("ended"), next: snap("ended", { endReason: "score-win" }) }), []);
});

test("command results map to feedback sounds", () => {
  assert.deepEqual(cueForCommandResult("place-tower", true), { id: "place-tower" });
  assert.deepEqual(cueForCommandResult("upgrade-tower", true), { id: "upgrade" });
  assert.deepEqual(cueForCommandResult("ready-for-wave", true), { id: "ready" });
  assert.deepEqual(cueForCommandResult("place-tower", false), { id: "rejected" });
  assert.equal(cueForCommandResult("advance-wave", true), null);
  assert.equal(cueForCommandResult("advance-wave", false), null);
  assert.equal(cueForCommandResult("set-target-mode", true), null);
});

test("an attack on an unknown tower has no pitch source", () => {
  const cues = cuesForSnapshotChange({
    previous: snap("wave"),
    next: snap("wave"),
    events: [ev({ type: "creature-attack", targetTowerId: "gone" })],
    suppress: false
  });
  assert.deepEqual(cues, [{ id: "tower-damaged" }]);
});

test("a fresh load into an ended match stays silent", () => {
  assert.deepEqual(ids([], { previous: null, next: snap("ended", { endReason: "score-win" }) }), []);
});
