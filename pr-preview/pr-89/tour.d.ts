export interface TourDialog {
    open(options?: {
        opener?: HTMLElement | null;
        onClose?: () => void;
    }): void;
    close(): void;
    isOpen(): boolean;
}
export declare function mountTour(options: {
    root: HTMLElement;
    onDismiss(): void;
}): TourDialog;
//# sourceMappingURL=tour.d.ts.map