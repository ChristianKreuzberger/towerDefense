import type { SimulationCommand } from "@tower-defense/shared";
export type FeedbackType = "accepted" | "rejected" | "info" | "error";
export declare function setStatus(text: string): void;
export declare function setMenuMessage(text: string): void;
export declare const REJECT_REASON_TEXT: Record<string, string>;
export declare const COMMAND_LABEL: Partial<Record<SimulationCommand["type"], string>>;
export declare function addFeedback(type: FeedbackType, message: string, commandType?: SimulationCommand["type"], reason?: string): void;
//# sourceMappingURL=feedback.d.ts.map