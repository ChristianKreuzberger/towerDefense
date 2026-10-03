import { lockPageBehind } from "./modal-inert.js";
import { TOUR_STEPS } from "./tour-data.js";
// Same dialog pattern as the map preview and the settings dialog (spec/11, "How-to-play tour").
export function mountTour(options) {
    const { root } = options;
    root.className = "settings-overlay";
    root.hidden = true;
    root.innerHTML = `
    <div class="settings-modal tour-modal" role="dialog" aria-modal="true" aria-labelledby="tourTitle">
      <div id="tourProgress" class="small" aria-live="polite"></div>
      <h2 id="tourTitle"></h2>
      <div id="tourBody" class="tour-body" aria-live="polite"></div>
      <div class="stack tour-actions">
        <button id="tourSkipBtn" type="button" class="ghost">Skip tour</button>
        <button id="tourBackBtn" type="button" class="ghost">Back</button>
        <button id="tourNextBtn" type="button" class="primary">Next</button>
      </div>
    </div>
  `;
    const query = (id) => {
        const found = root.querySelector(`#${id}`);
        if (!found) {
            throw new Error(`Missing tour element ${id}`);
        }
        return found;
    };
    const progress = query("tourProgress");
    const title = query("tourTitle");
    const body = query("tourBody");
    const skipBtn = query("tourSkipBtn");
    const backBtn = query("tourBackBtn");
    const nextBtn = query("tourNextBtn");
    let step = 0;
    let opener = null;
    let onClose;
    let release = null;
    function render() {
        const current = TOUR_STEPS[step];
        if (!current) {
            return;
        }
        progress.textContent = `Step ${step + 1} of ${TOUR_STEPS.length}`;
        title.textContent = current.title;
        body.replaceChildren(...current.body.map((text) => {
            const paragraph = document.createElement("p");
            paragraph.textContent = text;
            return paragraph;
        }));
        backBtn.hidden = step === 0;
        const last = step === TOUR_STEPS.length - 1;
        nextBtn.textContent = last ? "Start playing" : "Next";
        skipBtn.hidden = last;
    }
    function close() {
        if (root.hidden) {
            return;
        }
        root.hidden = true;
        release?.();
        release = null;
        options.onDismiss();
        const target = opener;
        const callback = onClose;
        opener = null;
        onClose = undefined;
        if (callback) {
            callback();
        }
        else {
            target?.focus();
        }
    }
    nextBtn.addEventListener("click", () => {
        if (step >= TOUR_STEPS.length - 1) {
            close();
        }
        else {
            step += 1;
            render();
            nextBtn.focus();
        }
    });
    backBtn.addEventListener("click", () => {
        step = Math.max(0, step - 1);
        render();
        nextBtn.focus();
    });
    skipBtn.addEventListener("click", close);
    root.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            close();
        }
        else if (event.key === "Tab") {
            // Wrap inside the dialog; with the page inert Tab would otherwise leave for the browser chrome.
            const buttons = [skipBtn, backBtn, nextBtn].filter((button) => !button.hidden);
            const first = buttons[0];
            const last = buttons[buttons.length - 1];
            if (first && last && event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            }
            else if (first && last && !event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        }
    });
    return {
        open(openOptions) {
            if (!root.hidden) {
                return;
            }
            step = 0;
            opener = openOptions?.opener ?? null;
            onClose = openOptions?.onClose;
            render();
            root.hidden = false;
            release = lockPageBehind(root);
            nextBtn.focus();
        },
        close,
        isOpen: () => !root.hidden
    };
}
