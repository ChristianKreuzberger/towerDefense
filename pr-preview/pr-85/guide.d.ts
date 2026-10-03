import type { MatchSnapshot } from "@tower-defense/shared";
export type GuideAction = "focus-place" | "place-tower" | "ready-player" | "toggle-playback";
export interface GuideState {
    key: string;
    tone: "place" | "ready" | "start" | "hint";
    title: string;
    body: string;
    actionLabel: string;
    action: GuideAction;
}
export declare function hideGuideOverlay(): void;
export declare function showGuideOverlay(state: GuideState): void;
export declare function activePlayerFromSnapshot(snapshot: MatchSnapshot): MatchSnapshot["players"][number] | null;
export declare function computeGuideState(snapshot: MatchSnapshot | null): GuideState | null;
export declare function syncGuideOverlay(snapshot: MatchSnapshot | null): void;
//# sourceMappingURL=guide.d.ts.map