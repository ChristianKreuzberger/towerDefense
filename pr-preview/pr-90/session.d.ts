import type { MatchSnapshot, SimulationCommand } from "@tower-defense/shared";
import type { WireSnapshot } from "@tower-defense/transport/wire-types";
export interface FetchSnapshotOptions {
    silentStatus?: boolean;
}
export declare function advanceTicks(ticks: number): Promise<void>;
export declare function fetchSnapshot(options?: FetchSnapshotOptions): Promise<MatchSnapshot | null>;
export declare function startFreshMatch(wire: WireSnapshot): void;
export declare function startMatchFromMenu(): Promise<void>;
export declare function rematchWithSamePlayers(): Promise<void>;
export declare function sendCommand(command: SimulationCommand): Promise<void>;
export declare const ADVANCE_MANY_TICKS = 200;
export declare function advanceMany(): Promise<void>;
//# sourceMappingURL=session.d.ts.map