import { lockPageBehind } from "./modal-inert.js";
import { TOUR_STEPS } from "./tour-data.js";

export interface TourDialog {
  // `onClose` runs after any dismissal (finish, skip or Esc) instead of returning focus to the opener.
  open(options?: { opener?: HTMLElement | null; onClose?: () => void }): void;
  close(): void;
  isOpen(): boolean;
}

// Same dialog pattern as the settings dialog (spec/11, "How-to-play tour").
export function mountTour(options: { root: HTMLElement; onDismiss(): void }): TourDialog {
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
  const query = <T extends HTMLElement>(id: string): T => {
    const found = root.querySelector<T>(`#${id}`);
    if (!found) {
      throw new Error(`Missing tour element ${id}`);
    }
    return found;
  };
  const progress = query<HTMLElement>("tourProgress");
  const title = query<HTMLElement>("tourTitle");
  const body = query<HTMLElement>("tourBody");
  const skipBtn = query<HTMLButtonElement>("tourSkipBtn");
  const backBtn = query<HTMLButtonElement>("tourBackBtn");
  const nextBtn = query<HTMLButtonElement>("tourNextBtn");
  let step = 0;
  let opener: HTMLElement | null = null;
  let onClose: (() => void) | undefined;
  let release: (() => void) | null = null;

  function render(): void {
    const current = TOUR_STEPS[step];
    if (!current) {
      return;
    }
    progress.textContent = `Step ${step + 1} of ${TOUR_STEPS.length}`;
    title.textContent = current.title;
    body.replaceChildren(
      ...current.body.map((text) => {
        const paragraph = document.createElement("p");
        paragraph.textContent = text;
        return paragraph;
      })
    );
    backBtn.hidden = step === 0;
    const last = step === TOUR_STEPS.length - 1;
    nextBtn.textContent = last ? "Start playing" : "Next";
    skipBtn.hidden = last;
  }

  function close(): void {
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
    } else {
      target?.focus();
    }
  }

  nextBtn.addEventListener("click", () => {
    if (step >= TOUR_STEPS.length - 1) {
      close();
    } else {
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
    } else if (event.key === "Tab") {
      // Wrap inside the dialog; with the page inert Tab would otherwise leave for the browser chrome.
      const buttons = [skipBtn, backBtn, nextBtn].filter((button) => !button.hidden);
      const first = buttons[0];
      const last = buttons[buttons.length - 1];
      if (first && last && event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (first && last && !event.shiftKey && document.activeElement === last) {
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
