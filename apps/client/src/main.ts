import { paintHero } from "./art/hero";
import { applyPaletteCssVars } from "./art/palette";
import { DEBUG } from "./constants";
import { installBotPacing } from "./bots";
import { installControls } from "./controls";
import { app, must } from "./dom";
import { setMenuMessage, setStatus } from "./feedback";
import { hideGuideOverlay } from "./guide";
import { installHotkeys } from "./hotkeys";
import { renderMenuPlayerInputs, showMenuScreen } from "./menu";
import { renderPhase } from "./phase";
import { fetchSnapshot } from "./session";
import { installTestHooks } from "./test-hooks";

import "./style.css";

// Player colours live in art/palette.ts; publish them as --p1..--p8 before anything renders.
applyPaletteCssVars();

installControls();
installBotPacing();
installHotkeys();

for (const element of document.querySelectorAll(".debug-only")) {
  element.classList.toggle("hidden", !DEBUG);
}

renderMenuPlayerInputs();
paintHero(must<HTMLCanvasElement>("menuHero"));
renderPhase(null);
showMenuScreen();
setStatus("No match yet.");
setMenuMessage("Create a local match or reconnect to an existing one.");
hideGuideOverlay();
// Hide both screens until the reconnect check answers, so a running match does not flash the menu first.
app.classList.add("booting");
const endBoot = (): void => app.classList.remove("booting");
setTimeout(endBoot, 1200);
void fetchSnapshot({ silentStatus: true }).finally(endBoot);

installTestHooks();
