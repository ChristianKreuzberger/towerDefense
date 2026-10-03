import assert from "node:assert/strict";
import test from "node:test";

import { createInertManager, type InertTarget } from "./modal-inert.js";

class Fake implements InertTarget {
  public inert = false;
  public constructor(public readonly name: string) {}
  public setAttribute(): void {
    this.inert = true;
  }
  public removeAttribute(): void {
    this.inert = false;
  }
}

function page(): { app: Fake; settings: Fake; end: Fake; manager: ReturnType<typeof createInertManager<Fake>>; all: Fake[] } {
  const app = new Fake("app");
  const settings = new Fake("settings");
  const end = new Fake("end");
  return { app, settings, end, manager: createInertManager<Fake>(), all: [app, settings, end] };
}

test("a lock makes the siblings inert and the release restores them", () => {
  const { app, settings, end, manager, all } = page();
  const release = manager.lock(end, all);
  assert.deepEqual([app.inert, settings.inert, end.inert], [true, true, false]);
  release();
  assert.deepEqual([app.inert, settings.inert, end.inert], [false, false, false]);
});

test("a modal opening over another is usable, and the page stays inert until both close", () => {
  const { app, settings, end, manager, all } = page();
  const releaseSettings = manager.lock(settings, all);
  assert.equal(end.inert, true);

  // The match ends while Settings is open: the end modal must be clickable and keep the page inert.
  const releaseEnd = manager.lock(end, all);
  assert.equal(end.inert, false);
  assert.equal(app.inert, true);

  releaseSettings();
  assert.equal(end.inert, false);
  assert.equal(app.inert, true, "the page behind the end modal stays inert after Settings closes");
  releaseEnd();
  assert.deepEqual([app.inert, settings.inert, end.inert], [false, false, false]);
});

test("locking the same root twice does not leave inert stuck", () => {
  const { app, end, manager, all } = page();
  const first = manager.lock(end, all);
  const second = manager.lock(end, all);
  assert.equal(first, second);
  first();
  assert.equal(app.inert, false);
});
