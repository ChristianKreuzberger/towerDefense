import type { MatchEvent, MatchSnapshot } from "@tower-defense/shared";
import type { WireSnapshot } from "@tower-defense/transport/wire-types";
export declare function onSnapshotApplied(handler: () => void): void;
export declare function applyWireSnapshot(wire: WireSnapshot, seq: number): boolean;
export declare function applySnapshot(snapshot: MatchSnapshot, newEvents: MatchEvent[]): void;
export declare function applySnapshotInner(snapshot: MatchSnapshot, newEvents: MatchEvent[]): void;
export declare function announceRepairEvents(snapshot: MatchSnapshot, events: MatchSnapshot["events"]): void;
//# sourceMappingURL=apply.d.ts.map