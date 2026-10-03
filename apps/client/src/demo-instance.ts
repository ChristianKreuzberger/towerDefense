import { applySnapshot } from "./apply";
import { createDemo } from "./demo";
import { el } from "./dom";
import { msPerTick } from "./playback";
import { store } from "./state";

// Debug-only synthetic combat: feeds creatures and events to the board without touching the host simulation.
export const demo = createDemo({
  current: () => store.current,
  feed: (snapshot, events) => applySnapshot(snapshot, events),
  tickMs: () => msPerTick(),
  onFinished: () => {
    el.demoBtn.textContent = "Demo Combat";
  }
});
