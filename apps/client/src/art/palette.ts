// Single source of truth for colours shared by the canvas scene and the DOM UI.
// Player colours are also published as CSS custom properties (--p1..--p8) by applyPaletteCssVars().

export const PLAYER_COLORS: readonly number[] = [
  0xe0583f, // vermilion
  0x3f86d0, // blue
  0xe0b43a, // amber
  0x8a6bd6, // violet
  0x2fa37a, // emerald
  0xd96aa8, // pink
  0x27a3b5, // teal
  0x9a6440 // brown
];

export const INK = 0x2a2530;
export const CREAM = 0xf3ead6;

export const TERRAIN = {
  road: 0xdccfae,
  roadSpeck: 0xc2b28a,
  roadGrid: 0xb9a97f,
  rut: 0x8f7b52,
  grass: [0x79a85f, 0x7fae64, 0x73a25a, 0x84b46a] as readonly number[],
  grassBlade: 0x5c8a48,
  grassEdge: 0x3f5f3a,
  flower: [0xf6efe0, 0xf2c9d8, 0xf5dc7a] as readonly number[],
  shadow: 0x2b2f26
};

export const ENEMY = {
  runner: { body: 0x4b3a5a, accent: 0xff9f43 },
  swarm: { body: 0x3f4a5a, accent: 0xa7e05f },
  armored: { body: 0x514a58, accent: 0xa9bccf },
  tank: { body: 0x3d3a44, accent: 0xe0675a }
};

export const UI_COLORS = {
  hover: 0xf3ead6,
  invalid: 0xff6b5e,
  cursor: 0xf2b84b,
  gold: 0xf2b84b,
  good: 0x5fbf8f,
  bad: 0xe0675a
};

export function playerIndex(playerId: string): number {
  const index = Number(playerId.replace(/\D+/g, "")) - 1;
  return Math.max(0, Math.min(PLAYER_COLORS.length - 1, Number.isFinite(index) ? index : 0));
}

export function colorForPlayer(playerId: string): number {
  return PLAYER_COLORS[playerIndex(playerId)] ?? 0xe0583f;
}

export function hex(color: number): string {
  return `#${color.toString(16).padStart(6, "0")}`;
}

// factor < 1 darkens, > 1 lightens (towards white).
export function shade(color: number, factor: number): number {
  const channel = (shift: number): number => {
    const value = (color >> shift) & 0xff;
    const next = factor <= 1 ? value * factor : value + (255 - value) * (factor - 1);
    return Math.max(0, Math.min(255, Math.round(next)));
  };
  return (channel(16) << 16) | (channel(8) << 8) | channel(0);
}

export function applyPaletteCssVars(root: HTMLElement = document.documentElement): void {
  PLAYER_COLORS.forEach((color, index) => {
    root.style.setProperty(`--p${index + 1}`, hex(color));
  });
  root.style.setProperty("--cream", hex(CREAM));
  root.style.setProperty("--gold", hex(UI_COLORS.gold));
  root.style.setProperty("--good", hex(UI_COLORS.good));
  root.style.setProperty("--bad", hex(UI_COLORS.bad));
}

// Deterministic per-cell randomness so a map always looks identical.
export function hash3(seed: number, x: number, y: number): number {
  let value = (seed | 0) ^ Math.imul(x + 0x9e37, 374761393) ^ Math.imul(y + 0x7f4a, 668265263);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  value ^= value >>> 16;
  return (value >>> 0) / 0xffffffff;
}
