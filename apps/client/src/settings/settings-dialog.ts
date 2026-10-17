import { lockPageBehind } from "../modal-inert.js";
import type { SoundEngine } from "../audio/sound-engine.js";
import type { SettingsStore } from "./settings.js";

export interface SettingsDialog {
  open(opener: HTMLElement | null): void;
  close(): void;
  isOpen(): boolean;
}

export function mountSettingsDialog(options: { root: HTMLElement; settings: SettingsStore; engine: SoundEngine }): SettingsDialog {
  const { root, settings, engine } = options;
  root.className = "settings-overlay";
  root.hidden = true;
  root.innerHTML = `
    <div class="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settingsTitle">
      <h2 id="settingsTitle">Settings</h2>
      <div class="settings-row">
        <label for="settingsVolume">Effects volume</label>
        <div class="settings-slider">
          <input id="settingsVolume" type="range" min="0" max="100" step="1" />
          <output id="settingsVolumeValue" for="settingsVolume"></output>
        </div>
      </div>
      <div class="settings-row">
        <button id="settingsMuteBtn" type="button" aria-pressed="false">Mute sound</button>
      </div>
      <div class="settings-row">
        <label for="settingsMusicVolume">Music volume</label>
        <div class="settings-slider">
          <input id="settingsMusicVolume" type="range" min="0" max="100" step="1" />
          <output id="settingsMusicVolumeValue" for="settingsMusicVolume"></output>
        </div>
      </div>
      <div class="settings-row">
        <button id="settingsMusicBtn" type="button" aria-pressed="false">Music: off</button>
      </div>
      <div class="settings-row">
        <button id="settingsEffectsBtn" type="button" aria-pressed="true">Visual effects: on</button>
      </div>
      <div class="stack">
        <button id="settingsCloseBtn" type="button" class="primary">Close</button>
      </div>
    </div>
  `;
  const query = <T extends HTMLElement>(id: string): T => {
    const found = root.querySelector<T>(`#${id}`);
    if (!found) {
      throw new Error(`Missing settings element ${id}`);
    }
    return found;
  };
  const slider = query<HTMLInputElement>("settingsVolume");
  const valueLabel = query<HTMLOutputElement>("settingsVolumeValue");
  const muteBtn = query<HTMLButtonElement>("settingsMuteBtn");
  const musicSlider = query<HTMLInputElement>("settingsMusicVolume");
  const musicValueLabel = query<HTMLOutputElement>("settingsMusicVolumeValue");
  const musicBtn = query<HTMLButtonElement>("settingsMusicBtn");
  const effectsBtn = query<HTMLButtonElement>("settingsEffectsBtn");
  const closeBtn = query<HTMLButtonElement>("settingsCloseBtn");
  let opener: HTMLElement | null = null;
  let release: (() => void) | null = null;

  // aria-modal alone does not stop Tab or screen readers reaching the page behind, so the siblings are made inert.
  function setBackgroundInert(on: boolean): void {
    if (on) {
      release = lockPageBehind(root);
    } else {
      release?.();
      release = null;
    }
  }

  function render(): void {
    const { effectsVolume, muted, effects, musicEnabled, musicVolume } = settings.get();
    const musicPercent = Math.round(musicVolume * 100);
    musicSlider.value = String(musicPercent);
    musicSlider.setAttribute("aria-valuetext", `${musicPercent} percent`);
    musicValueLabel.textContent = `${musicPercent}%`;
    musicBtn.setAttribute("aria-pressed", String(musicEnabled));
    musicBtn.textContent = musicEnabled ? "Music: on" : "Music: off";
    const percent = Math.round(effectsVolume * 100);
    slider.value = String(percent);
    slider.setAttribute("aria-valuetext", `${percent} percent`);
    valueLabel.textContent = `${percent}%`;
    muteBtn.setAttribute("aria-pressed", String(muted));
    muteBtn.textContent = muted ? "Unmute sound" : "Mute sound";
    effectsBtn.setAttribute("aria-pressed", String(effects));
    effectsBtn.textContent = effects ? "Visual effects: on" : "Visual effects: off";
  }

  function close(): void {
    if (root.hidden) {
      return;
    }
    root.hidden = true;
    setBackgroundInert(false);
    const target = opener;
    opener = null;
    target?.focus();
  }

  slider.addEventListener("input", () => {
    settings.set({ effectsVolume: Number(slider.value) / 100 });
    engine.previewVolume();
  });
  muteBtn.addEventListener("click", () => settings.set({ muted: !settings.get().muted }));
  musicSlider.addEventListener("input", () => settings.set({ musicVolume: Number(musicSlider.value) / 100 }));
  musicBtn.addEventListener("click", () => settings.set({ musicEnabled: !settings.get().musicEnabled }));
  effectsBtn.addEventListener("click", () => settings.set({ effects: !settings.get().effects }));
  closeBtn.addEventListener("click", close);
  root.addEventListener("pointerdown", (event) => {
    if (event.target === root) {
      close();
    }
  });
  root.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
  });
  // Also reflects changes made elsewhere, such as the M hotkey.
  settings.subscribe(render);
  render();

  return {
    open(from) {
      opener = from;
      render();
      root.hidden = false;
      setBackgroundInert(true);
      slider.focus();
    },
    close,
    isOpen: () => !root.hidden
  };
}
