import type { StorageLike } from "./settings/settings.js";
export interface TourStep {
    title: string;
    body: string[];
}
export declare const TOUR_STEPS: readonly TourStep[];
export declare const TOUR_STORAGE_KEY = "towerDefense.tour.v1";
export declare function parseTourSeen(raw: string | null): boolean;
export interface TourStore {
    hasSeen(): boolean;
    markSeen(): void;
}
export declare function createTourStore(storage?: StorageLike | null): TourStore;
//# sourceMappingURL=tour-data.d.ts.map