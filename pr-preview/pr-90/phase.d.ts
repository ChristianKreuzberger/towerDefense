import type { MatchEvent, MatchSnapshot } from "@tower-defense/shared";
export declare function showWaveBanner(title: string, sub: string): void;
export declare function showTurnBanner(player: {
    id: string;
    name: string;
}): void;
export declare function announceWaveEnd(events: MatchEvent[]): void;
export declare function phaseSubText(snapshot: MatchSnapshot): string;
export declare function renderPhase(snapshot: MatchSnapshot | null): void;
//# sourceMappingURL=phase.d.ts.map