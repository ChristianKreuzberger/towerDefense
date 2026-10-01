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
        <button id="settingsMuteBtn" type="button" aria-pressed="false">Mute effects</button>
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
  const closeBtn = query<HTMLButtonElement>("settingsCloseBtn");
  let opener: HTMLElement | null = null;
  let inerted: Element[] = [];

  // aria-modal alone does not stop Tab or screen readers reaching the page behind, so the siblings are made inert.
  function setBackgroundInert(on: boolean): void {
    if (on) {
      inerted = [...(root.parentElement?.children ?? [])].filter((node) => node !== root && !node.hasAttribute("inert"));
      inerted.forEach((node) => node.setAttribute("inert", ""));
    } else {
      inerted.forEach((node) => node.removeAttribute("inert"));
      inerted = [];
    }
  }

  function render(): void {
    const { effectsVolume, muted } = settings.get();
    const percent = Math.round(effectsVolume * 100);
    slider.value = String(percent);
    slider.setAttribute("aria-valuetext", `${percent} percent`);
    valueLabel.textContent = `${percent}%`;
    muteBtn.setAttribute("aria-pressed", String(muted));
    muteBtn.textContent = muted ? "Unmute effects" : "Mute effects";
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
