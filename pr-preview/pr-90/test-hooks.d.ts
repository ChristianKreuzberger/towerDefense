interface TestBoardHook {
    findTowerSpot(index?: number): {
        x: number;
        y: number;
    } | null;
    cellSize(): number;
    demo?: {
        start(): boolean;
        stop(): void;
        running(): boolean;
    };
    cellToPixel(x: number, y: number): {
        x: number;
        y: number;
    };
    creaturePositions(): Array<{
        id: string;
        x: number;
        y: number;
    }>;
    playback(): {
        playing: boolean;
        speed: number;
    };
    zoom(): number;
}
declare global {
    interface Window {
        __testBoard?: TestBoardHook;
    }
}
export declare function installTestHooks(): void;
export {};
//# sourceMappingURL=test-hooks.d.ts.map