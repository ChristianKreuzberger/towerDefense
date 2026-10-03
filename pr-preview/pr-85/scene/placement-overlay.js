import { BASE_TOWER_UPGRADES, MAX_TOWER_LEVEL, getTowerStats, isInSpawnProtection } from "@tower-defense/shared";
import { CREAM, UI_COLORS, playerIndex } from "../art/palette";
import { KEY } from "../art/textures";
import { describeRuin } from "../ruins";
import { cellCenter } from "./geometry";
export function isHoverValid(s, x, y) {
    const context = s.placementContext;
    if (!context) {
        return false;
    }
    if (context.phase !== "placement") {
        return false;
    }
    const cell = s.cellsByKey.get(`${x},${y}`);
    if (!cell || !s.towerSpotKeys.has(`${x},${y}`) || isInSpawnProtection({ spawn: s.spawn }, x, y)) {
        return false;
    }
    return !s.occupiedCells.has(`${x},${y}`);
}
function isGhostValid(s, x, y) {
    if (!s.placementContext) {
        return false;
    }
    if (!s.placementContext.moveMode && s.placementContext.hasTowerAlready) {
        return false;
    }
    return isHoverValid(s, x, y);
}
export function drawHoverAndGhost(s, env) {
    const hover = s.hoverGraphics;
    const ghostBase = s.ghostBase;
    const ghostTurret = s.ghostTurret;
    if (!hover || !ghostBase || !ghostTurret) {
        return;
    }
    hover.clear();
    ghostBase.setVisible(false);
    ghostTurret.setVisible(false);
    const cellSize = env.cellSize;
    // The active player's tower gets a steady ring so it is easy to find on a busy board.
    const activeId = s.placementContext ? `tower-${s.placementContext.playerId}` : null;
    const activeTower = activeId ? env.towerVisuals.get(activeId) : undefined;
    if (activeTower) {
        hover.lineStyle(Math.max(2, cellSize * 0.07), CREAM, 0.85);
        hover.strokeCircle(activeTower.baseX, activeTower.baseY, cellSize * 1.0);
    }
    if (s.hoverTowerId) {
        const hovered = env.towerVisuals.get(s.hoverTowerId);
        if (hovered) {
            hover.lineStyle(Math.max(2, cellSize * 0.08), UI_COLORS.hover, 0.95);
            hover.strokeCircle(hovered.baseX, hovered.baseY, cellSize * 1.08);
            drawRangeCircle(env, hover, hovered.baseX, hovered.baseY, getTowerStats(hovered.upgrades).range);
        }
    }
    updateTowerTooltip(s, env);
    if (s.hoverX === null || s.hoverY === null) {
        return;
    }
    const x = s.hoverX;
    const y = s.hoverY;
    if (!isHoverValid(s, x, y)) {
        return;
    }
    const radius = cellSize * 0.14;
    hover.fillStyle(UI_COLORS.hover, 0.22);
    hover.fillRoundedRect(x * cellSize, y * cellSize, cellSize, cellSize, radius);
    hover.lineStyle(2, UI_COLORS.hover, 0.9);
    hover.strokeRoundedRect(x * cellSize + 1, y * cellSize + 1, cellSize - 2, cellSize - 2, radius);
    if (isGhostValid(s, x, y) && s.placementContext) {
        const { cx, cy } = cellCenter(x, y, cellSize);
        const index = playerIndex(s.placementContext.playerId);
        ghostBase.setTexture(KEY.towerBase(index)).setPosition(cx, cy).setVisible(true);
        ghostTurret.setTexture(KEY.turret(index, 0)).setPosition(cx, cy).setVisible(true);
        // Placement is one-shot, so show the coverage before the player commits.
        drawRangeCircle(env, hover, cx, cy, getTowerStats(BASE_TOWER_UPGRADES).range);
    }
}
function updateTowerTooltip(s, env) {
    const tooltip = s.tooltip;
    if (!tooltip) {
        return;
    }
    const tower = s.hoverTowerId ? env.towerVisuals.get(s.hoverTowerId) : undefined;
    const ruin = !tower && s.hoverRuinId ? env.ruinVisuals.get(s.hoverRuinId) : undefined;
    if (ruin) {
        const { title, detail } = describeRuin(ruin);
        const heading = document.createElement("strong");
        heading.textContent = title;
        const body = document.createElement("div");
        body.textContent = detail;
        tooltip.replaceChildren(heading, body);
        positionTooltip(env, tooltip, ruin.image.x, ruin.image.y);
        return;
    }
    if (!tower) {
        tooltip.hidden = true;
        return;
    }
    const stats = getTowerStats(tower.upgrades);
    const trackLevel = (level) => `${level}/${MAX_TOWER_LEVEL}`;
    const rows = [
        ["Level", String(stats.level)],
        ["Health", `${tower.hp}/${tower.maxHp}`],
        ["Range", `${stats.range} cells (${trackLevel(tower.upgrades.range)})`],
        ["Damage", `${stats.damagePerShot} per shot (${trackLevel(tower.upgrades.damage)})`],
        ["Type", tower.damageType],
        ["DPS", String(stats.damagePerSecond)],
        ["Accuracy", `${Math.round(stats.accuracy * 100)}% (${trackLevel(tower.upgrades.accuracy)})`]
    ];
    tooltip.replaceChildren(...rows.map(([label, value]) => {
        const row = document.createElement("div");
        const name = document.createElement("span");
        name.textContent = label;
        const val = document.createElement("strong");
        val.textContent = value;
        row.append(name, val);
        return row;
    }));
    positionTooltip(env, tooltip, tower.baseX, tower.baseY);
}
function positionTooltip(env, tooltip, worldX, worldY) {
    const canvas = env.getCanvas();
    const rect = canvas.getBoundingClientRect();
    const scale = canvas.width > 0 ? rect.width / canvas.width : 1;
    tooltip.style.left = `${canvas.offsetLeft + worldX * scale}px`;
    tooltip.style.top = `${canvas.offsetTop + worldY * scale - env.cellSize * scale * 0.9}px`;
    tooltip.hidden = false;
}
function drawRangeCircle(env, graphics, cx, cy, rangeCells) {
    const radius = rangeCells * env.cellSize;
    graphics.fillStyle(UI_COLORS.hover, 0.08);
    graphics.fillCircle(cx, cy, radius);
    graphics.lineStyle(Math.max(2, env.cellSize * 0.06), UI_COLORS.hover, 0.5);
    graphics.strokeCircle(cx, cy, radius);
}
