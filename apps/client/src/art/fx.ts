// Pooled, allocation-free-per-frame effects (projectiles, sparks, puffs, particles, floating text).
// Everything is created on first use, recycled, and only mutated by update().
import Phaser from "phaser";

import { INK } from "./palette";
import { KEY } from "./textures";

type Kind = "bolt" | "spark" | "puff" | "smoke" | "particle";

interface FxSprite {
  image: Phaser.GameObjects.Image;
  active: boolean;
  kind: Kind;
  start: number;
  duration: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  scale0: number;
  scale1: number;
  spin: number;
}

interface FxText {
  text: Phaser.GameObjects.Text;
  active: boolean;
  start: number;
  duration: number;
  x: number;
  y: number;
  rise: number;
}

const MAX_SPRITES = 220;
const MAX_TEXTS = 14;
const FONT = 'system-ui, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

export class Effects {
  private readonly sprites: FxSprite[] = [];
  private readonly texts: FxText[] = [];
  private activeCount = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    private cellSize: number,
    private readonly depth: number,
    private reducedMotion: boolean
  ) {}

  setCellSize(cellSize: number): void {
    this.cellSize = cellSize;
  }

  clear(): void {
    for (const sprite of this.sprites) {
      sprite.active = false;
      sprite.image.setVisible(false);
    }
    for (const text of this.texts) {
      text.active = false;
      text.text.setVisible(false);
    }
    this.activeCount = 0;
  }

  private acquireSprite(kind: Kind, key: string, tint: number): FxSprite | null {
    let sprite = this.sprites.find((entry) => !entry.active);
    if (!sprite) {
      if (this.sprites.length >= MAX_SPRITES) {
        return null;
      }
      const image = this.scene.add.image(0, 0, key).setDepth(this.depth).setVisible(false);
      sprite = { image, active: false, kind, start: 0, duration: 0, x0: 0, y0: 0, x1: 0, y1: 0, scale0: 1, scale1: 1, spin: 0 };
      this.sprites.push(sprite);
    }
    sprite.kind = kind;
    sprite.active = true;
    // Pooled sprites must not inherit a spin from a previous spark; it would override a bolt's heading.
    sprite.spin = 0;
    sprite.image.setTexture(key).setTint(tint).setAlpha(0).setVisible(false).setRotation(0);
    this.activeCount += 1;
    return sprite;
  }

  // Positions are world pixels; delayMs staggers events that arrived in one batched response.
  // `tier` is the shooter's style tier (0 to 4): higher tiers fire longer, thicker bolts with a brighter muzzle flash
  // and, from tier 3, a white core.
  projectile(x0: number, y0: number, x1: number, y1: number, color: number, delayMs: number, tier = 0): void {
    const distance = Math.hypot(x1 - x0, y1 - y0);
    const sprite = this.acquireSprite("bolt", KEY.bolt, color);
    if (!sprite) {
      return;
    }
    sprite.start = performance.now() + delayMs;
    sprite.duration = Math.max(90, Math.min(260, distance * 1.4));
    sprite.x0 = x0;
    sprite.y0 = y0;
    sprite.x1 = x1;
    sprite.y1 = y1;
    const length = ((this.cellSize * 0.9) / 48) * (1 + tier * 0.2);
    const heading = Math.atan2(y1 - y0, x1 - x0);
    sprite.scale0 = length;
    sprite.scale1 = length;
    sprite.image.setRotation(heading);
    this.spark(x1, y1, color, delayMs + sprite.duration);
    if (tier >= 2) {
      this.spark(x0, y0, 0xffffff, delayMs);
    }
    if (tier >= 3) {
      const core = this.acquireSprite("bolt", KEY.bolt, 0xffffff);
      if (core) {
        core.start = sprite.start;
        core.duration = sprite.duration;
        core.x0 = x0;
        core.y0 = y0;
        core.x1 = x1;
        core.y1 = y1;
        core.scale0 = length * 0.55;
        core.scale1 = length * 0.55;
        core.image.setRotation(heading);
      }
    }
  }

  // Level-up shine: an expanding gold glow, sparkles, and (for a new style tier) a second, larger wave.
  shine(x: number, y: number, bigger: boolean, delayMs: number): void {
    const wave = this.acquireSprite("puff", KEY.soft, 0xffe08a);
    if (wave) {
      wave.start = performance.now() + delayMs;
      wave.duration = this.reducedMotion ? 200 : 650;
      wave.x0 = x;
      wave.y0 = y;
      wave.x1 = x;
      wave.y1 = y;
      wave.scale0 = (this.cellSize * 0.8) / 32;
      wave.scale1 = (this.cellSize * (this.reducedMotion ? 1.4 : bigger ? 4.2 : 3)) / 32;
    }
    this.burst(x, y, 0xf2b84b, delayMs);
    if (bigger) {
      this.burst(x, y, 0xffffff, delayMs + 140);
    }
  }

  spark(x: number, y: number, color: number, delayMs: number): void {
    const sprite = this.acquireSprite("spark", KEY.spark, color);
    if (!sprite) {
      return;
    }
    sprite.start = performance.now() + delayMs;
    sprite.duration = this.reducedMotion ? 120 : 220;
    sprite.x0 = x;
    sprite.y0 = y;
    sprite.x1 = x;
    sprite.y1 = y;
    sprite.scale0 = (this.cellSize * 0.35) / 32;
    sprite.scale1 = (this.cellSize * (this.reducedMotion ? 0.35 : 0.85)) / 32;
    sprite.spin = this.reducedMotion ? 0 : 1.2;
  }

  puff(x: number, y: number, color: number, delayMs: number): void {
    const sprite = this.acquireSprite("puff", KEY.soft, color);
    if (!sprite) {
      return;
    }
    sprite.start = performance.now() + delayMs;
    sprite.duration = this.reducedMotion ? 180 : 420;
    sprite.x0 = x;
    sprite.y0 = y;
    sprite.x1 = x;
    sprite.y1 = y - this.cellSize * 0.25;
    sprite.scale0 = (this.cellSize * 0.5) / 32;
    sprite.scale1 = (this.cellSize * (this.reducedMotion ? 0.9 : 1.6)) / 32;
  }

  smoke(x: number, y: number, delayMs: number): void {
    const count = this.reducedMotion ? 1 : 5;
    for (let i = 0; i < count; i += 1) {
      const sprite = this.acquireSprite("smoke", KEY.soft, i % 2 === 0 ? 0x4a4650 : 0x6b6670);
      if (!sprite) {
        return;
      }
      sprite.start = performance.now() + delayMs + i * 110;
      sprite.duration = this.reducedMotion ? 500 : 1300;
      sprite.x0 = x + (Math.random() - 0.5) * this.cellSize * 0.7;
      sprite.y0 = y;
      sprite.x1 = sprite.x0 + (Math.random() - 0.5) * this.cellSize * 0.6;
      sprite.y1 = y - this.cellSize * 1.6;
      sprite.scale0 = (this.cellSize * 0.6) / 32;
      sprite.scale1 = (this.cellSize * 1.7) / 32;
    }
  }

  burst(x: number, y: number, color: number, delayMs: number): void {
    if (this.reducedMotion) {
      return;
    }
    const count = 8;
    for (let i = 0; i < count; i += 1) {
      const sprite = this.acquireSprite("particle", KEY.dot, i % 3 === 0 ? 0xf3ead6 : color);
      if (!sprite) {
        return;
      }
      const angle = (Math.PI * 2 * i) / count + Math.random() * 0.6;
      const distance = this.cellSize * (0.7 + Math.random() * 0.7);
      sprite.start = performance.now() + delayMs;
      sprite.duration = 380 + Math.random() * 160;
      sprite.x0 = x;
      sprite.y0 = y;
      sprite.x1 = x + Math.cos(angle) * distance;
      sprite.y1 = y + Math.sin(angle) * distance;
      sprite.scale0 = (this.cellSize * 0.24) / 16;
      sprite.scale1 = (this.cellSize * 0.05) / 16;
    }
  }

  floatText(x: number, y: number, label: string, color: number, delayMs: number): void {
    let entry = this.texts.find((candidate) => !candidate.active);
    if (!entry) {
      if (this.texts.length >= MAX_TEXTS) {
        return;
      }
      const text = this.scene.add
        .text(0, 0, label, { fontFamily: FONT, fontStyle: "800", fontSize: "16px", color: "#ffffff", stroke: `#${INK.toString(16)}`, strokeThickness: 4 })
        .setOrigin(0.5, 0.5)
        .setDepth(this.depth + 0.5)
        .setVisible(false);
      entry = { text, active: false, start: 0, duration: 0, x: 0, y: 0, rise: 0 };
      this.texts.push(entry);
    }
    entry.active = true;
    entry.start = performance.now() + delayMs;
    entry.duration = this.reducedMotion ? 900 : 1100;
    entry.x = x;
    entry.y = y;
    entry.rise = this.reducedMotion ? 0 : this.cellSize * 1.4;
    entry.text.setText(label);
    entry.text.setColor(`#${color.toString(16).padStart(6, "0")}`);
    entry.text.setFontSize(Math.max(14, Math.round(this.cellSize * 0.75)));
    entry.text.setAlpha(0).setVisible(false);
    this.activeCount += 1;
  }

  update(now: number): void {
    if (this.activeCount === 0) {
      return;
    }
    for (const sprite of this.sprites) {
      if (!sprite.active) {
        continue;
      }
      const t = (now - sprite.start) / sprite.duration;
      if (t < 0) {
        continue;
      }
      if (t >= 1) {
        sprite.active = false;
        sprite.image.setVisible(false);
        this.activeCount -= 1;
        continue;
      }
      const image = sprite.image;
      const eased = sprite.kind === "bolt" ? t : 1 - (1 - t) * (1 - t);
      image.setVisible(true);
      image.setPosition(sprite.x0 + (sprite.x1 - sprite.x0) * eased, sprite.y0 + (sprite.y1 - sprite.y0) * eased);
      image.setScale(sprite.scale0 + (sprite.scale1 - sprite.scale0) * eased);
      if (sprite.spin !== 0) {
        image.setRotation(sprite.spin * t);
      }
      switch (sprite.kind) {
        case "bolt":
          image.setAlpha(1);
          break;
        case "smoke":
          image.setAlpha(0.6 * (1 - t));
          break;
        case "puff":
          image.setAlpha(0.75 * (1 - t));
          break;
        default:
          image.setAlpha(1 - t * t);
      }
    }
    for (const entry of this.texts) {
      if (!entry.active) {
        continue;
      }
      const t = (now - entry.start) / entry.duration;
      if (t < 0) {
        continue;
      }
      if (t >= 1) {
        entry.active = false;
        entry.text.setVisible(false);
        this.activeCount -= 1;
        continue;
      }
      const eased = 1 - (1 - t) * (1 - t);
      entry.text.setVisible(true);
      entry.text.setPosition(entry.x, entry.y - entry.rise * eased);
      entry.text.setAlpha(t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3);
    }
  }
}
