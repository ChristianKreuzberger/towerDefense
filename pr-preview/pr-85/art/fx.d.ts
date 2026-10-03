import Phaser from "phaser";
export declare class Effects {
    private readonly scene;
    private cellSize;
    private readonly depth;
    private reducedMotion;
    private readonly sprites;
    private readonly texts;
    private activeCount;
    constructor(scene: Phaser.Scene, cellSize: number, depth: number, reducedMotion: boolean);
    setCellSize(cellSize: number): void;
    clear(): void;
    private acquireSprite;
    projectile(x0: number, y0: number, x1: number, y1: number, color: number, delayMs: number, tier?: number): void;
    shine(x: number, y: number, bigger: boolean, delayMs: number): void;
    spark(x: number, y: number, color: number, delayMs: number): void;
    puff(x: number, y: number, color: number, delayMs: number): void;
    smoke(x: number, y: number, delayMs: number): void;
    burst(x: number, y: number, color: number, delayMs: number): void;
    explosion(x: number, y: number, delayMs: number): void;
    floatText(x: number, y: number, label: string, color: number, delayMs: number): void;
    update(now: number): void;
}
//# sourceMappingURL=fx.d.ts.map