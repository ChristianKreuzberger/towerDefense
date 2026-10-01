import { lockPageBehind } from "./modal-inert.js";
import { isInSpawnProtection, type GameMap, type MatchSnapshot } from "@tower-defense/shared";

export type PreviewCellKind = "pad" | "lane" | "blocked" | "cave";

export interface PreviewCell {
  kind: PreviewCellKind;
  // Inside the cave's no-build area (this can overlay lane cells too).
  isProtected: boolean;
}

// rows[y][x]. Buildable cells connected to the cave are the lane creatures walk; other buildable cells are tower pads;
// everything unbuildable is blocked ground. Maze maps put the lane in corridors, so "buildable" alone would mislead.
export function classifyMapCells(map: GameMap): PreviewCell[][] {
  const rows: PreviewCell[][] = Array.from({ length: map.height }, () =>
    Array.from({ length: map.width }, () => ({ kind: "blocked" as PreviewCellKind, isProtected: false }))
  );
  const buildable = new Set(map.cells.filter((cell) => cell.buildable).map((cell) => `${cell.x},${cell.y}`));
  const lane = new Set<string>();
  if (map.spawn) {
    const start = `${map.spawn.x},${map.spawn.y}`;
    const queue: Array<[number, number]> = [[map.spawn.x, map.spawn.y]];
    lane.add(start);
    while (queue.length > 0) {
      const [x, y] = queue.pop() ?? [0, 0];
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const key = `${x + dx},${y + dy}`;
        if (buildable.has(key) && !lane.has(key)) {
          lane.add(key);
          queue.push([x + dx, y + dy]);
        }
      }
    }
  }
  for (const cell of map.cells) {
    const row = rows[cell.y];
    if (!row || cell.x < 0 || cell.x >= map.width) {
      continue;
    }
    const key = `${cell.x},${cell.y}`;
    const isCave = map.spawn !== undefined && cell.x === map.spawn.x && cell.y === map.spawn.y;
    row[cell.x] = {
      kind: isCave ? "cave" : lane.has(key) ? "lane" : cell.buildable ? "pad" : "blocked",
      isProtected: isInSpawnProtection(map, cell.x, cell.y)
    };
  }
  return rows;
}

const COLORS: Record<PreviewCellKind, string> = { pad: "#f2b84b", lane: "#e4d5b0", blocked: "#5d8a45", cave: "#2c2a33" };

export function drawMapPreview(canvas: HTMLCanvasElement, map: GameMap): void {
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

export interface MapPreviewDialog {
  open(snapshot: MatchSnapshot): void;
  close(): void;
  isOpen(): boolean;
}

// Same dialog pattern as the settings dialog and the match-end modal (spec/11, "Map preview step").
export function mountMapPreview(options: { root: HTMLElement; playerNumber(playerId: string): number; onContinue(): void }): MapPreviewDialog {
  const { root } = options;
  root.className = "settings-overlay";
  root.hidden = true;
  root.innerHTML = `
    <div class="settings-modal map-preview-modal" role="dialog" aria-modal="true" aria-labelledby="mapPreviewTitle">
      <h2 id="mapPreviewTitle">Map preview</h2>
      <div id="mapPreviewMeta" class="small"></div>
      <canvas id="mapPreviewCanvas" class="map-preview-canvas" role="img" aria-label="Overview of the generated map"></canvas>
      <ul class="map-preview-legend">
        <li><i class="legend-swatch pad"></i> Tower pad (build here)</li>
        <li><i class="legend-swatch lane"></i> Lane the creatures walk</li>
        <li><i class="legend-swatch blocked"></i> Blocked ground</li>
        <li><i class="legend-swatch cave"></i> Monster cave</li>
        <li><i class="legend-swatch protected"></i> Protected area (no building)</li>
      </ul>
      <div id="mapPreviewPlayers" class="map-preview-players"></div>
      <div class="stack"><button id="mapPreviewContinueBtn" type="button" class="primary">Continue</button></div>
    </div>
  `;
  const query = <T extends HTMLElement>(id: string): T => {
    const found = root.querySelector<T>(`#${id}`);
    if (!found) {
      throw new Error(`Missing map preview element ${id}`);
    }
    return found;
  };
  const meta = query<HTMLElement>("mapPreviewMeta");
  const canvas = query<HTMLCanvasElement>("mapPreviewCanvas");
  const players = query<HTMLElement>("mapPreviewPlayers");
  const continueBtn = query<HTMLButtonElement>("mapPreviewContinueBtn");
  let release: (() => void) | null = null;

  function setBackgroundInert(on: boolean): void {
    if (on) {
      release = lockPageBehind(root);
    } else {
      release?.();
      release = null;
    }
  }

  function close(): void {
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
    } else if (event.key === "Tab") {
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
      players.replaceChildren(
        ...snapshot.players.map((player) => {
          const row = document.createElement("div");
          row.className = "menu-player";
          const swatch = document.createElement("span");
          const number = options.playerNumber(player.id);
          swatch.className = `swatch ${player.id}`;
          swatch.textContent = String(number);
          swatch.setAttribute("aria-hidden", "true");
          const name = document.createElement("span");
          name.textContent = `Player ${number}: ${player.name}`;
          row.append(swatch, name);
          return row;
        })
      );
      root.hidden = false;
      setBackgroundInert(true);
      continueBtn.focus();
    },
    close,
    isOpen: () => !root.hidden
  };
}
