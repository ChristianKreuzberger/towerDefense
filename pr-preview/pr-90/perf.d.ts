export interface PerfStats {
    enabled: boolean;
    snapshotCount: number;
    applyLastMs: number;
    applyAvgMs: number;
    applyMaxMs: number;
    lastSnapshotBytes: number;
    totalSnapshotBytes: number;
    fps: number;
    minFps: number;
    reset(): void;
}
declare global {
    interface Window {
        __perf?: PerfStats;
    }
}
export declare function perfTimeApply<T>(run: () => T): T;
export declare function perfRecordBytes(bytes: number): void;
//# sourceMappingURL=perf.d.ts.map