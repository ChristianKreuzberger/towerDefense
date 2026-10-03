import { createSoundEngine } from "./audio/index";
import { el, must } from "./dom";
import { mountMapPreview } from "./map-preview";
import { playerNumber } from "./player-util";
import { createSettingsStore } from "./settings/settings";
import { mountSettingsDialog } from "./settings/settings-dialog";
import { mountTour } from "./tour";
import { createTourStore } from "./tour-data";

// Long-lived presentation services (settings, sound, dialogs) created once at startup.

export const settingsStore = createSettingsStore();
export const soundEngine = createSoundEngine({ settings: settingsStore });
soundEngine.bindUnlock(document);
export const mapPreview = mountMapPreview({
  root: must<HTMLElement>("mapPreviewRoot"),
  playerNumber: (playerId) => playerNumber(playerId),
  // Placement for the first player starts once the preview is dismissed; the guide already points at them.
  onContinue: () => el.placeTowerBtn.focus()
});
export const tourStore = createTourStore();
export const tour = mountTour({ root: must<HTMLElement>("tourRoot"), onDismiss: () => tourStore.markSeen() });
export const settingsDialog = mountSettingsDialog({ root: must<HTMLElement>("settingsRoot"), settings: settingsStore, engine: soundEngine });
