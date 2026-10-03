// Pure 2D-canvas painters. They know nothing about Phaser so the menu diorama can reuse them.
import { SPAWN_PROTECTION_RADIUS, type CreatureArchetype, type MapCell } from "@tower-defense/shared";

import { CREAM, ENEMY, INK, TERRAIN, hash3, hex, shade } from "./palette";

type Ctx = CanvasRenderingContext2D;

function outline(ctx: Ctx, fill: number, lineWidth: number, stroke = INK): void {
  ctx.fillStyle = hex(fill);
  ctx.fill();
  ctx.lineWidth = lineWidth;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.strokeStyle = hex(stroke);
  ctx.stroke();
}

function circle(ctx: Ctx, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
}

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// ---------------------------------------------------------------- terrain

// Buildable cells are the walkable layer and are drawn as the road; non-buildable cells are raised grass pads.
// Grass plots are raised pads on a continuous road: each plot's corners are rounded only where
// both orthogonal neighbours are road (four-neighbour mask), and the plot casts a soft shadow onto the road.
export function paintTerrain(
  ctx: Ctx,
  cells: MapCell[],
  width: number,
  height: number,
  cs: number,
  seed: number,
  spawn?: { x: number; y: number },
  towerSpots: Array<{ x: number; y: number }> = []
): void {
  const grass = new Uint8Array(width * height);
  for (const cell of cells) {
    if (!cell.buildable) {
      grass[cell.y * width + cell.x] = 1;
    }
  }
  const isGrass = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < width && y < height && grass[y * width + x] === 1;
  const w = width * cs;
  const h = height * cs;

  ctx.fillStyle = hex(TERRAIN.road);
  ctx.fillRect(0, 0, w, h);

  // Faint cell grid so placement stays legible on the open road.
  ctx.strokeStyle = hex(TERRAIN.roadGrid);
  ctx.globalAlpha = 0.28;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 1; x < width; x += 1) {
    ctx.moveTo(x * cs + 0.5, 0);
    ctx.lineTo(x * cs + 0.5, h);
  }
  for (let y = 1; y < height; y += 1) {
    ctx.moveTo(0, y * cs + 0.5);
    ctx.lineTo(w, y * cs + 0.5);
  }
  ctx.stroke();
  ctx.globalAlpha = 1;

  // Road speckles: tiny pebbles only (cosmetic; the simulation has no blocked cells).
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (isGrass(x, y)) {
        continue;
      }
      const count = Math.floor(hash3(seed + 11, x, y) * 3.2);
      for (let i = 0; i < count; i += 1) {
        const px = x * cs + (0.12 + 0.76 * hash3(seed + 21 + i, x, y)) * cs;
        const py = y * cs + (0.12 + 0.76 * hash3(seed + 31 + i, y, x)) * cs;
        ctx.fillStyle = hex(TERRAIN.roadSpeck);
        ctx.beginPath();
        ctx.ellipse(px, py, cs * 0.05 + cs * 0.03 * hash3(seed + 41 + i, x, y), cs * 0.04, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  const radius = cs * 0.34;
  const plotPath = (x: number, y: number): void => {
    const n = isGrass(x, y - 1);
    const e = isGrass(x + 1, y);
    const s = isGrass(x, y + 1);
    const wv = isGrass(x - 1, y);
    const tl = !n && !wv ? radius : 0;
    const tr = !n && !e ? radius : 0;
    const br = !s && !e ? radius : 0;
    const bl = !s && !wv ? radius : 0;
    const px = x * cs;
    const py = y * cs;
    ctx.beginPath();
    ctx.moveTo(px + tl, py);
    ctx.lineTo(px + cs - tr, py);
    if (tr) ctx.arcTo(px + cs, py, px + cs, py + tr, tr); else ctx.lineTo(px + cs, py);
    ctx.lineTo(px + cs, py + cs - br);
    if (br) ctx.arcTo(px + cs, py + cs, px + cs - br, py + cs, br); else ctx.lineTo(px + cs, py + cs);
    ctx.lineTo(px + bl, py + cs);
    if (bl) ctx.arcTo(px, py + cs, px, py + cs - bl, bl); else ctx.lineTo(px, py + cs);
    ctx.lineTo(px, py + tl);
    if (tl) ctx.arcTo(px, py, px + tl, py, tl); else ctx.lineTo(px, py);
    ctx.closePath();
  };

  // Pass 1: soft shadow + dark silhouette (its union forms the crisp outline once grass is painted over it).
  ctx.save();
  ctx.shadowColor = "rgba(43, 47, 38, 0.45)";
  ctx.shadowBlur = cs * 0.22;
  ctx.shadowOffsetY = cs * 0.14;
  ctx.fillStyle = hex(TERRAIN.grassEdge);
  ctx.strokeStyle = hex(TERRAIN.grassEdge);
  ctx.lineWidth = Math.max(2, cs * 0.09);
  ctx.lineJoin = "round";
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (isGrass(x, y)) {
        plotPath(x, y);
        ctx.fill();
        ctx.stroke();
      }
    }
  }
  ctx.restore();

  // Pass 2: grass fill with seeded variants.
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!isGrass(x, y)) {
        continue;
      }
      const variant = Math.floor(hash3(seed, x, y) * TERRAIN.grass.length);
      plotPath(x, y);
      ctx.fillStyle = hex(TERRAIN.grass[variant] ?? TERRAIN.grass[0] ?? 0x79a85f);
      ctx.fill();
    }
  }

  // Pass 3: decoration (blades, flowers) and a lit top edge on plot borders facing the road.
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!isGrass(x, y)) {
        continue;
      }
      const px = x * cs;
      const py = y * cs;
      const roll = hash3(seed + 5, x, y);
      ctx.strokeStyle = hex(TERRAIN.grassBlade);
      ctx.lineWidth = Math.max(1, cs * 0.05);
      ctx.lineCap = "round";
      const blades = 1 + Math.floor(roll * 3);
      for (let i = 0; i < blades; i += 1) {
        const bx = px + (0.22 + 0.56 * hash3(seed + 50 + i, x, y)) * cs;
        const by = py + (0.3 + 0.5 * hash3(seed + 60 + i, y, x)) * cs;
        ctx.beginPath();
        ctx.moveTo(bx - cs * 0.06, by);
        ctx.lineTo(bx, by - cs * 0.14);
        ctx.lineTo(bx + cs * 0.06, by);
        ctx.stroke();
      }
      if (roll > 0.86) {
        const color = TERRAIN.flower[Math.floor(hash3(seed + 7, x, y) * TERRAIN.flower.length)] ?? TERRAIN.flower[0] ?? 0xffffff;
        ctx.fillStyle = hex(color);
        circle(ctx, px + (0.25 + 0.5 * hash3(seed + 8, x, y)) * cs, py + (0.25 + 0.5 * hash3(seed + 9, x, y)) * cs, cs * 0.06);
        ctx.fill();
      }
      if (!isGrass(x, y - 1)) {
        ctx.strokeStyle = "rgba(255, 255, 240, 0.22)";
        ctx.lineWidth = Math.max(1, cs * 0.06);
        ctx.beginPath();
        ctx.moveTo(px + cs * 0.2, py + cs * 0.08);
        ctx.lineTo(px + cs * 0.8, py + cs * 0.08);
        ctx.stroke();
      }
    }
  }

  for (const spot of towerSpots) {
    paintTowerSpot(ctx, spot, cs);
  }

  if (spawn) {
    paintSpawnZone(ctx, spawn, cs);
  }
  paintGates(ctx, width, height, cs, !spawn);
  if (spawn) {
    paintCave(ctx, spawn, cs);
  }
}

// Stone pad marking a cell that accepts a tower; it stays visible so players know where they may build.
function paintTowerSpot(ctx: Ctx, spot: { x: number; y: number }, cs: number): void {
  const px = spot.x * cs + cs * 0.08;
  const py = spot.y * cs + cs * 0.08;
  const size = cs * 0.84;
  roundRect(ctx, px, py, size, size, cs * 0.18);
  outline(ctx, TERRAIN.spot, Math.max(2, cs * 0.07), INK);
  ctx.strokeStyle = "rgba(255, 255, 240, 0.55)";
  ctx.lineWidth = Math.max(1.5, cs * 0.05);
  ctx.setLineDash([cs * 0.16, cs * 0.12]);
  roundRect(ctx, px + cs * 0.1, py + cs * 0.1, size - cs * 0.2, size - cs * 0.2, cs * 0.12);
  ctx.stroke();
  ctx.setLineDash([]);
}

// Faint warning tint over the cells where towers are not allowed (see SPAWN_PROTECTION_RADIUS).
function paintSpawnZone(ctx: Ctx, spawn: { x: number; y: number }, cs: number): void {
  const cx = (spawn.x + 0.5) * cs;
  const cy = (spawn.y + 0.5) * cs;
  // Placement distance is measured between cell centres, so the zone edge sits at the radius from the cave cell centre.
  const r = SPAWN_PROTECTION_RADIUS * cs + cs / 2;
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.clip();
  circle(ctx, cx, cy, r);
  ctx.fillStyle = "rgba(196, 71, 58, 0.16)";
  ctx.fill();
  ctx.setLineDash([cs * 0.3, cs * 0.25]);
  ctx.lineWidth = Math.max(2, cs * 0.07);
  ctx.strokeStyle = "rgba(196, 71, 58, 0.7)";
  ctx.stroke();
  ctx.restore();
}

// Monster cave: a rocky mound on the left edge with a dark mouth that faces the map.
function paintCave(ctx: Ctx, spawn: { x: number; y: number }, cs: number): void {
  const cy = (spawn.y + 0.5) * cs;
  const rock = 0x8a7f8c;
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(0, cy, cs * 1.9, cs * 1.6, 0, -Math.PI / 2, Math.PI / 2);
  ctx.closePath();
  outline(ctx, rock, Math.max(2, cs * 0.07));
  // lit upper rim
  ctx.strokeStyle = "rgba(255,255,255,0.3)";
  ctx.lineWidth = Math.max(1.5, cs * 0.06);
  ctx.beginPath();
  ctx.ellipse(0, cy, cs * 1.7, cs * 1.4, 0, -Math.PI / 2, -Math.PI / 5);
  ctx.stroke();
  // boulders
  for (const [bx, by, br] of [[1.5, -1.0, 0.3], [1.55, 1.0, 0.26], [0.7, -1.45, 0.22], [0.8, 1.4, 0.2]] as const) {
    circle(ctx, bx * cs, cy + by * cs, br * cs);
    outline(ctx, shade(rock, 1.15), Math.max(1.5, cs * 0.05));
  }
  // dark mouth
  ctx.beginPath();
  ctx.ellipse(0, cy, cs * 1.25, cs * 0.85, 0, -Math.PI / 2, Math.PI / 2);
  ctx.closePath();
  outline(ctx, 0x16121b, Math.max(2, cs * 0.06), INK);
  // glowing eyes deep inside
  ctx.fillStyle = "rgba(255, 159, 67, 0.95)";
  for (const dy of [-0.2, 0.2]) {
    circle(ctx, cs * 0.45, cy + dy * cs, cs * 0.06);
    ctx.fill();
  }
  ctx.restore();
}

// Left edge: spawn gate (hazard stripes + chevrons), only when the map has no cave. Right edge: goal (chequered strip).
function paintGates(ctx: Ctx, width: number, height: number, cs: number, spawnGate: boolean): void {
  const band = Math.max(4, Math.round(cs * 0.2));
  const h = height * cs;
  ctx.save();
  for (let y = 0; y < height; y += 1) {
    for (let k = 0; k < 4 && spawnGate; k += 1) {
      ctx.fillStyle = (y * 4 + k) % 2 === 0 ? "#c4473a" : hex(INK);
      ctx.fillRect(0, y * cs + (k * cs) / 4, band, cs / 4);
    }
    const goalX = width * cs - band;
    for (let k = 0; k < 4; k += 1) {
      for (let j = 0; j < 2; j += 1) {
        ctx.fillStyle = (k + j + y) % 2 === 0 ? hex(CREAM) : hex(INK);
        ctx.fillRect(goalX + j * (band / 2), y * cs + (k * cs) / 4, band / 2, cs / 4);
      }
    }
  }
  ctx.fillStyle = "rgba(196, 71, 58, 0.9)";
  for (let y = 1; y < height && spawnGate; y += 4) {
    const cy = y * cs + cs / 2;
    ctx.beginPath();
    ctx.moveTo(band + cs * 0.12, cy - cs * 0.22);
    ctx.lineTo(band + cs * 0.42, cy);
    ctx.lineTo(band + cs * 0.12, cy + cs * 0.22);
    ctx.lineTo(band + cs * 0.2, cy);
    ctx.closePath();
    ctx.fill();
  }
  ctx.strokeStyle = hex(INK);
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, width * cs - 2, h - 2);
  ctx.restore();
}

// Rut overlay for a worn road cell; alpha is set by the caller from the wear level.
export function paintRut(ctx: Ctx, cs: number): void {
  ctx.clearRect(0, 0, cs, cs);
  ctx.fillStyle = hex(TERRAIN.rut);
  ctx.globalAlpha = 0.35;
  ctx.fillRect(0, 0, cs, cs);
  ctx.globalAlpha = 0.9;
  ctx.strokeStyle = hex(shade(TERRAIN.rut, 0.75));
  ctx.lineWidth = Math.max(1.5, cs * 0.08);
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(cs * 0.08, cs * 0.36);
  ctx.lineTo(cs * 0.92, cs * 0.36);
  ctx.moveTo(cs * 0.08, cs * 0.66);
  ctx.lineTo(cs * 0.92, cs * 0.66);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

// ---------------------------------------------------------------- towers

export function paintTowerBase(ctx: Ctx, s: number, color: number): void {
  const c = s / 2;
  const lw = Math.max(1.5, s * 0.035);
  circle(ctx, c, c, s * 0.44);
  outline(ctx, shade(color, 0.6), lw);
  circle(ctx, c, c, s * 0.375);
  outline(ctx, color, lw * 0.8, shade(color, 0.5));
  // lit rim
  ctx.strokeStyle = "rgba(255,255,255,0.4)";
  ctx.lineWidth = lw;
  ctx.beginPath();
  ctx.arc(c, c, s * 0.33, Math.PI * 1.05, Math.PI * 1.65);
  ctx.stroke();
  // dark platform so the cream turret reads clearly on top
  circle(ctx, c, c, s * 0.27);
  outline(ctx, shade(color, 0.42), lw * 0.8, shade(color, 0.3));
}

export function paintTurret(ctx: Ctx, s: number, color: number, level: number): void {
  const c = s / 2;
  const lw = Math.max(1.5, s * 0.035);
  const barrels = level >= 5 ? 3 : level >= 3 ? 2 : 1;
  const length = s * (level >= 2 ? 0.64 : 0.58);
  const width = s * (level >= 2 ? 0.17 : 0.15);
  for (let i = 0; i < barrels; i += 1) {
    const offset = barrels === 1 ? 0 : barrels === 2 ? (i === 0 ? -1 : 1) * s * 0.085 : (i - 1) * s * 0.12;
    roundRect(ctx, c, c - width / 2 + offset, length, width, width * 0.25);
    outline(ctx, 0x575d6b, lw);
    // muzzle cap and lit top edge
    roundRect(ctx, c + length - s * 0.09, c - width / 2 - s * 0.015 + offset, s * 0.1, width + s * 0.03, s * 0.02);
    outline(ctx, 0xe8e0c8, lw);
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.lineWidth = lw * 0.7;
    ctx.beginPath();
    ctx.moveTo(c + s * 0.12, c - width * 0.28 + offset);
    ctx.lineTo(c + length - s * 0.12, c - width * 0.28 + offset);
    ctx.stroke();
  }
  // Squared cream housing reads as a cannon mount rather than a second ring.
  const half = s * (0.17 + Math.min(level, 5) * 0.015);
  roundRect(ctx, c - half, c - half, half * 2, half * 2, half * 0.45);
  outline(ctx, 0xf3ead6, lw);
  roundRect(ctx, c - half * 0.5, c - half * 0.5, half, half, half * 0.25);
  outline(ctx, color, lw * 0.8, shade(color, 0.45));
  if (level >= 4) {
    roundRect(ctx, c - half * 1.22, c - half * 1.22, half * 2.44, half * 2.44, half * 0.6);
    ctx.strokeStyle = hex(0xf2b84b);
    ctx.lineWidth = lw * 1.4;
    ctx.stroke();
  }
  if (level >= 5) {
    // Top style: a glowing gem in the mount.
    circle(ctx, c, c, half * 0.3);
    outline(ctx, 0xffe08a, lw * 0.8, 0xb8791a);
  }
}

export function paintTowerBadge(ctx: Ctx, s: number, label: string): void {
  const c = s / 2;
  circle(ctx, c, c, s * 0.42);
  outline(ctx, CREAM, Math.max(1.5, s * 0.08));
  ctx.fillStyle = hex(INK);
  ctx.font = `800 ${Math.round(s * 0.62)}px system-ui, "Segoe UI", Roboto, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, c, c + s * 0.04);
}

export function paintPips(ctx: Ctx, w: number, h: number, count: number): void {
  const r = h * 0.36;
  const gap = r * 2.6;
  const start = w / 2 - ((count - 1) * gap) / 2;
  for (let i = 0; i < count; i += 1) {
    circle(ctx, start + i * gap, h / 2, r);
    outline(ctx, 0xf2b84b, Math.max(1, r * 0.4));
  }
}

// ---------------------------------------------------------------- creatures (facing +x, top-down)

export function paintCreature(ctx: Ctx, archetype: CreatureArchetype, s: number): void {
  const { body, accent } = ENEMY[archetype];
  const c = s / 2;
  const lw = Math.max(1.5, s * 0.045);
  switch (archetype) {
    case "runner": {
      ctx.beginPath();
      ctx.moveTo(s * 0.94, c);
      ctx.quadraticCurveTo(s * 0.62, s * 0.2, s * 0.14, s * 0.3);
      ctx.lineTo(s * 0.04, s * 0.18);
      ctx.lineTo(s * 0.1, c);
      ctx.lineTo(s * 0.04, s * 0.82);
      ctx.lineTo(s * 0.14, s * 0.7);
      ctx.quadraticCurveTo(s * 0.62, s * 0.8, s * 0.94, c);
      ctx.closePath();
      outline(ctx, body, lw);
      ctx.strokeStyle = hex(accent);
      ctx.lineWidth = lw * 1.3;
      ctx.beginPath();
      ctx.moveTo(s * 0.26, s * 0.4);
      ctx.lineTo(s * 0.58, s * 0.4);
      ctx.moveTo(s * 0.26, s * 0.6);
      ctx.lineTo(s * 0.58, s * 0.6);
      ctx.stroke();
      circle(ctx, s * 0.76, s * 0.44, s * 0.05);
      ctx.fillStyle = hex(accent);
      ctx.fill();
      circle(ctx, s * 0.76, s * 0.56, s * 0.05);
      ctx.fill();
      break;
    }
    case "swarm": {
      ctx.strokeStyle = hex(INK);
      ctx.lineWidth = lw;
      ctx.lineCap = "round";
      for (let i = 0; i < 3; i += 1) {
        const lx = s * (0.3 + i * 0.17);
        ctx.beginPath();
        ctx.moveTo(lx, c);
        ctx.lineTo(lx - s * 0.06, s * 0.08);
        ctx.moveTo(lx, c);
        ctx.lineTo(lx - s * 0.06, s * 0.92);
        ctx.stroke();
      }
      circle(ctx, c, c, s * 0.33);
      outline(ctx, body, lw);
      circle(ctx, s * 0.62, s * 0.4, s * 0.085);
      outline(ctx, accent, lw * 0.6);
      circle(ctx, s * 0.62, s * 0.6, s * 0.085);
      outline(ctx, accent, lw * 0.6);
      break;
    }
    case "armored": {
      const hexPath = (r: number): void => {
        ctx.beginPath();
        for (let i = 0; i < 6; i += 1) {
          const a = (Math.PI / 3) * i + Math.PI / 6;
          const px = c + Math.cos(a) * r;
          const py = c + Math.sin(a) * r;
          if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.closePath();
      };
      circle(ctx, s * 0.88, c, s * 0.1);
      outline(ctx, body, lw);
      hexPath(s * 0.42);
      outline(ctx, body, lw);
      hexPath(s * 0.3);
      outline(ctx, accent, lw * 0.9, shade(accent, 0.45));
      ctx.fillStyle = hex(shade(accent, 0.6));
      for (let i = 0; i < 6; i += 1) {
        const a = (Math.PI / 3) * i + Math.PI / 6;
        circle(ctx, c + Math.cos(a) * s * 0.36, c + Math.sin(a) * s * 0.36, s * 0.022);
        ctx.fill();
      }
      break;
    }
    case "tank": {
      roundRect(ctx, s * 0.12, s * 0.1, s * 0.66, s * 0.2, s * 0.05);
      outline(ctx, 0x2a2730, lw);
      roundRect(ctx, s * 0.12, s * 0.7, s * 0.66, s * 0.2, s * 0.05);
      outline(ctx, 0x2a2730, lw);
      ctx.strokeStyle = "rgba(255,255,255,0.18)";
      ctx.lineWidth = lw * 0.8;
      ctx.beginPath();
      for (let i = 0; i < 6; i += 1) {
        const tx = s * (0.18 + i * 0.1);
        ctx.moveTo(tx, s * 0.12);
        ctx.lineTo(tx, s * 0.28);
        ctx.moveTo(tx, s * 0.72);
        ctx.lineTo(tx, s * 0.88);
      }
      ctx.stroke();
      roundRect(ctx, s * 0.1, s * 0.22, s * 0.7, s * 0.56, s * 0.1);
      outline(ctx, body, lw);
      roundRect(ctx, c + s * 0.05, c - s * 0.045, s * 0.4, s * 0.09, s * 0.03);
      outline(ctx, accent, lw);
      circle(ctx, c - s * 0.02, c, s * 0.19);
      outline(ctx, shade(body, 1.25), lw);
      circle(ctx, c - s * 0.02, c, s * 0.07);
      outline(ctx, accent, lw * 0.7);
      break;
    }
  }
}

// ---------------------------------------------------------------- effects

export function paintSoftDisc(ctx: Ctx, s: number): void {
  const gradient = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.55, "rgba(255,255,255,0.75)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, s, s);
}

export function paintShadow(ctx: Ctx, s: number): void {
  const gradient = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  gradient.addColorStop(0, "rgba(30,28,24,0.5)");
  gradient.addColorStop(0.7, "rgba(30,28,24,0.28)");
  gradient.addColorStop(1, "rgba(30,28,24,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, s, s);
}

export function paintSpark(ctx: Ctx, s: number): void {
  const c = s / 2;
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  for (let i = 0; i < 8; i += 1) {
    const a = (Math.PI / 4) * i;
    const r = i % 2 === 0 ? c : c * 0.28;
    const px = c + Math.cos(a) * r;
    const py = c + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
}

export function paintBolt(ctx: Ctx, w: number, h: number): void {
  const gradient = ctx.createLinearGradient(0, 0, w, 0);
  gradient.addColorStop(0, "rgba(255,255,255,0)");
  gradient.addColorStop(1, "rgba(255,255,255,1)");
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
  ctx.fill();
}

export function paintDot(ctx: Ctx, s: number): void {
  ctx.fillStyle = "#ffffff";
  circle(ctx, s / 2, s / 2, s / 2 - 1);
  ctx.fill();
}

// Ruins fill the 2x2 footprint of a tower: scorch mark, broken base ring in the owner colour, rubble and a cracked slab.
export function paintRuin(ctx: Ctx, s: number, color: number): void {
  ctx.clearRect(0, 0, s, s);
  const scorch = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s * 0.46);
  scorch.addColorStop(0, "rgba(20,16,14,0.65)");
  scorch.addColorStop(1, "rgba(20,16,14,0)");
  ctx.fillStyle = scorch;
  ctx.fillRect(0, 0, s, s);

  // Broken ring: arcs with gaps, so it reads as a collapsed base rather than a live one.
  ctx.lineCap = "round";
  ctx.strokeStyle = hex(shade(color, 0.6));
  ctx.lineWidth = Math.max(2, s * 0.07);
  for (const [from, to] of [[0.2, 0.9], [1.2, 1.55], [1.8, 2.5], [3.3, 3.9], [4.4, 5.6]] as const) {
    ctx.beginPath();
    ctx.arc(s / 2, s / 2, s * 0.32, from * Math.PI, to * Math.PI * 0.99);
    ctx.stroke();
  }

  // Rubble chunks at fixed positions so the ruin looks identical on every redraw.
  const chunks: Array<[number, number, number, number]> = [
    [0.36, 0.42, 0.11, 0.7], [0.58, 0.36, 0.08, 0.5], [0.62, 0.6, 0.12, 0.8],
    [0.42, 0.64, 0.09, 0.6], [0.5, 0.5, 0.07, 0.9], [0.28, 0.58, 0.06, 0.5], [0.7, 0.46, 0.06, 0.6]
  ];
  for (const [x, y, size, tone] of chunks) {
    roundRect(ctx, s * (x - size / 2), s * (y - size / 2), s * size, s * size * 0.8, s * 0.015);
    outline(ctx, shade(0x8a8378, tone), Math.max(1, s * 0.015));
  }
  // Remains of the turret in the owner colour.
  roundRect(ctx, s * 0.44, s * 0.4, s * 0.12, s * 0.09, s * 0.02);
  outline(ctx, color, Math.max(1, s * 0.015), shade(color, 0.5));
}
