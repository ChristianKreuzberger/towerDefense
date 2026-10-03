import type { MatchEvent, MatchSnapshot } from "@tower-defense/shared";
export interface DemoDeps {
    current(): MatchSnapshot | null;
    feed(snapshot: MatchSnapshot, events: MatchEvent[], glideMs: number): void;
    tickMs(): number;
    onFinished(): void;
}
export declare function findLane(map: MatchSnapshot["map"]): Array<{
    x: number;
    y: number;
}>;
export declare function createDemo(deps: DemoDeps): {
    start(): boolean;
    stop(): void;
    running(): boolean;
};
//# sourceMappingURL=demo.d.ts.map