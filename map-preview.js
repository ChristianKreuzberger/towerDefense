import { lockPageBehind } from "./modal-inert.js";
import { isInSpawnProtection } from "@tower-defense/shared";
// rows[y][x]. Buildable cells are the road creatures walk, towerSpots are the only places for towers, and
// everything else is plain grass ("blocked" here, since nothing can happen on it).
export function classifyMapCells(map) {
    const rows = Array.from({ length: map.height }, () => Array.from({ length: map.width }, () => ({ kind: "blocked", isProtected: false })));
    for (const cell of map.cells) {
        const row = rows[cell.y];
        if (!row || cell.x < 0 || cell.x >= map.width) {
            continue;
        }
        const isSpot = map.towerSpots.some((spot) => spot.x === cell.x && spot.y === cell.y);
        const isCave = map.spawn !== undefined && cell.x === map.spawn.x && cell.y === map.spawn.y;
        row[cell.x] = {
            kind: isCave ? "cave" : isSpot ? "pad" : cell.buildable ? "lane" : "blocked",
            isProtected: isInSpawnProtection(map, cell.x, cell.y)
        };
    }
    return rows;
}
const COLORS = { pad: "#f2b84b", lane: "#e4d5b0", blocked: "#5d8a45", cave: "#2c2a33" };
export function drawMapPreview(canvas, map) {
    const scale = Math.max(3, Math.floor(300 / Math.max(map.width, map.height)));
    canvas.width = map.width * scale;
    canvas.height = map.height * scale;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
        return;
    }
    classifyMapCells(map).forEach((row, y) => {
        row.forEach((cell, x) => {
            ctx.fillStyle = COLORS[cell.kind];
            ctx.fillRect(x * scale, y * scale, scale, scale);
            if (cell.isProtected) {
                ctx.fillStyle = "rgba(220, 70, 60, 0.35)";
                ctx.fillRect(x * scale, y * scale, scale, scale);
            }
        });
    });
}
// Same dialog pattern as the settings dialog and the match-end modal (spec/11, "Map preview step").
export function mountMapPreview(options) {
    const { root } = options;
    root.className = "settings-overlay";
    root.hidden = true;
    root.innerHTML = `
    <div class="settings-modal map-preview-modal" role="dialog" aria-modal="true" aria-labelledby="mapPreviewTitle">
      <h2 id="mapPreviewTitle">Map preview</h2>
      <div id="mapPreviewMeta" class="small"></div>
      <canvas id="mapPreviewCanvas" class="map-preview-canvas" role="img" aria-label="Overview of the generated map"></canvas>
      <ul class="map-preview-legend">
        <li><i class="legend-swatch pad"></i> Tower spot (build here)</li>
        <li><i class="legend-swatch lane"></i> Road the creatures walk</li>
        <li><i class="legend-swatch blocked"></i> Grass</li>
        <li><i class="legend-swatch cave"></i> Monster cave</li>
        <li><i class="legend-swatch protected"></i> Protected area (no building)</li>
      </ul>
      <div id="mapPreviewPlayers" class="map-preview-players"></div>
      <div class="stack"><button id="mapPreviewContinueBtn" type="button" class="primary">Continue</button></div>
    </div>
  `;
    const query = (id) => {
        const found = root.querySelector(`#${id}`);
        if (!found) {
            throw new Error(`Missing map preview element ${id}`);
        }
        return found;
    };
    const meta = query("mapPreviewMeta");
    const canvas = query("mapPreviewCanvas");
    const players = query("mapPreviewPlayers");
    const continueBtn = query("mapPreviewContinueBtn");
    let release = null;
    function setBackgroundInert(on) {
        if (on) {
            release = lockPageBehind(root);
        }
        else {
            release?.();
            release = null;
        }
    }
    function close() {
        if (root.hidden) {
            return;
        }
        root.hidden = true;
        setBackgroundInert(false);
        options.onContinue();
    }
    continueBtn.addEventListener("click", close);
    root.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            close();
        }
        else if (event.key === "Tab") {
            // The only control is the Continue button, so Tab simply stays on it.
            event.preventDefault();
            continueBtn.focus();
        }
    });
    return {
        open(snapshot) {
            if (!root.hidden) {
                return;
            }
            meta.textContent = `Seed ${snapshot.map.seed} • ${snapshot.map.width}x${snapshot.map.height} tiles`;
            drawMapPreview(canvas, snapshot.map);
            players.replaceChildren(...snapshot.players.map((player) => {
                const row = document.createElement("div");
                row.className = "menu-player";
                const swatch = document.createElement("span");
                const number = options.playerNumber(player.id);
                swatch.className = `swatch ${player.id}`;
                swatch.textContent = String(number);
                swatch.setAttribute("aria-hidden", "true");
                const name = document.createElement("span");
                name.textContent = `Player ${number}: ${player.name}${player.ai ? ` (${player.ai} bot)` : ""}`;
                row.append(swatch, name);
                return row;
            }));
            root.hidden = false;
            setBackgroundInert(true);
            continueBtn.focus();
        },
        close,
        isOpen: () => !root.hidden
    };
}
