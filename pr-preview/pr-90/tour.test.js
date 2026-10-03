import assert from "node:assert/strict";
import { test } from "node:test";
import { STARTING_POINTS, WIN_SCORE } from "@tower-defense/shared";
import { TOUR_STEPS, TOUR_STORAGE_KEY, createTourStore, parseTourSeen } from "./tour-data.js";
function memoryStorage(initial) {
    const data = new Map(Object.entries(initial ?? {}));
    return { data, getItem: (key) => data.get(key) ?? null, setItem: (key, value) => void data.set(key, value) };
}
test("parseTourSeen only accepts an explicit seen: true", () => {
    assert.equal(parseTourSeen(null), false);
    assert.equal(parseTourSeen("{not json"), false);
    assert.equal(parseTourSeen("[true]"), false);
    assert.equal(parseTourSeen(JSON.stringify({ version: 1, seen: "yes" })), false);
    assert.equal(parseTourSeen(JSON.stringify({ version: 1, seen: true })), true);
});
test("the tour store starts unseen, persists markSeen and reads it back", () => {
    const storage = memoryStorage();
    const store = createTourStore(storage);
    assert.equal(store.hasSeen(), false);
    store.markSeen();
    assert.equal(store.hasSeen(), true);
    assert.deepEqual(JSON.parse(storage.data.get(TOUR_STORAGE_KEY) ?? "null"), { version: 1, seen: true });
    assert.equal(createTourStore(storage).hasSeen(), true);
});
test("the tour store survives missing or throwing storage", () => {
    const broken = {
        getItem: () => {
            throw new Error("blocked");
        },
        setItem: () => {
            throw new Error("blocked");
        }
    };
    const store = createTourStore(broken);
    assert.equal(store.hasSeen(), false);
    store.markSeen();
    assert.equal(store.hasSeen(), true);
    const none = createTourStore(null);
    none.markSeen();
    assert.equal(none.hasSeen(), true);
});
test("the tour explains the goal with the shared rule values", () => {
    assert.ok(TOUR_STEPS.length >= 4);
    assert.ok(TOUR_STEPS[0]?.body.join(" ").includes(String(WIN_SCORE)));
    assert.ok(TOUR_STEPS.some((step) => step.body.join(" ").includes(String(STARTING_POINTS))));
    for (const step of TOUR_STEPS) {
        assert.ok(step.title.length > 0 && step.body.length > 0);
    }
});
test("the placement step states the real rules: no building near the cave, no blocking the route", () => {
    const prep = TOUR_STEPS[1]?.body.join(" ") ?? "";
    assert.ok(prep.includes("within 5 cells of the monster cave"));
    assert.ok(prep.includes("block the creatures' route"));
    assert.ok(!prep.includes("clear of"));
});
