import { createSoundEngine } from "./audio/index";
import { must } from "./dom";
import { createSettingsStore } from "./settings/settings";
import { mountSettingsDialog } from "./settings/settings-dialog";
import { mountTour } from "./tour";
import { createTourStore } from "./tour-data";

// Long-lived presentation services (settings, sound, dialogs) created once at startup.

export const settingsStore = createSettingsStore();
export const soundEngine = createSoundEngine({ settings: settingsStore });
soundEngine.bindUnlock(document);
export const tourStore = createTourStore();
export const tour = mountTour({ root: must<HTMLElement>("tourRoot"), onDismiss: () => tourStore.markSeen() });
export const settingsDialog = mountSettingsDialog({ root: must<HTMLElement>("settingsRoot"), settings: settingsStore, engine: soundEngine });
