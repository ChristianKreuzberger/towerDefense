import type { SoundEngine } from "../audio/sound-engine.js";
import type { SettingsStore } from "./settings.js";
export interface SettingsDialog {
    open(opener: HTMLElement | null): void;
    close(): void;
    isOpen(): boolean;
}
export declare function mountSettingsDialog(options: {
    root: HTMLElement;
    settings: SettingsStore;
    engine: SoundEngine;
}): SettingsDialog;
//# sourceMappingURL=settings-dialog.d.ts.map