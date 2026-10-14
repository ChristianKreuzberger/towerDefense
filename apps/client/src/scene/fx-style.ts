import type { DamageType } from "@tower-defense/shared";

// Pure presentation helpers for effects, kept apart from Phaser so they can be unit tested.

// One colour per damage type so hits read as physical (bone), explosive (orange) or magic (violet) at a glance.
export const DAMAGE_TYPE_FX_COLOR: Record<DamageType, number> = { physical: 0xe8e0c8, explosive: 0xff9a3c, magic: 0xb48cff };

export const FROST_FX_COLOR = 0x7fd6ff;

// Kills worth at least this much (tank, boss) get the larger burst.
export const BIG_KILL_REWARD = 20;

// Longer tower shake for harder creature hits: 1x at damage 1 up to 2x.
export function shakeScale(damage: number): number {
  return Math.min(2, 1 + Math.max(0, damage - 1) * 0.1);
}

export function isBigKill(rewardPoints: number): boolean {
  return rewardPoints >= BIG_KILL_REWARD;
}
