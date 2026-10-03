import { lockPageBehind } from "../modal-inert.js";
export function mountSettingsDialog(options) {
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
    const query = (id) => {
        const found = root.querySelector(`#${id}`);
        if (!found) {
            throw new Error(`Missing settings element ${id}`);
        }
        return found;
    };
    const slider = query("settingsVolume");
    const valueLabel = query("settingsVolumeValue");
    const muteBtn = query("settingsMuteBtn");
    const closeBtn = query("settingsCloseBtn");
    let opener = null;
    let release = null;
    // aria-modal alone does not stop Tab or screen readers reaching the page behind, so the siblings are made inert.
    function setBackgroundInert(on) {
        if (on) {
            release = lockPageBehind(root);
        }
        else {
            release?.();
            release = null;
        }
    }
    function render() {
        const { effectsVolume, muted } = settings.get();
        const percent = Math.round(effectsVolume * 100);
        slider.value = String(percent);
        slider.setAttribute("aria-valuetext", `${percent} percent`);
        valueLabel.textContent = `${percent}%`;
        muteBtn.setAttribute("aria-pressed", String(muted));
        muteBtn.textContent = muted ? "Unmute effects" : "Mute effects";
    }
    function close() {
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
